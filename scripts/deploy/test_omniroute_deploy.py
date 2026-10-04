#!/usr/bin/env python3
"""Focused manual harness for the production deploy transaction."""

import contextlib
import copy
import hashlib
import http.server
import importlib.util
import io
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch


MODULE_PATH = os.path.join(os.path.dirname(__file__), "omniroute-deploy.py")
SPEC = importlib.util.spec_from_file_location("omniroute_deploy", MODULE_PATH)
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)


DIGEST = "sha256:" + ("a" * 64)
SOURCE_SHA = "b" * 40
RUN_ID = "12345678901234567890"
ATTEMPT = "2"
VALID_RECORD = ("%s %s %s %s\n" % (DIGEST, SOURCE_SHA, RUN_ID, ATTEMPT)).encode("ascii")
KEY = RUN_ID + "-" + ATTEMPT


class FakeStore(object):
    def __init__(self, root):
        self.root = root
        self.records = {}
        self.updates = []

    def get(self, key):
        value = self.records.get(key)
        return dict(value) if value is not None else None

    @contextlib.contextmanager
    def _launch_locked(self, key):
        yield

    def create(self, request):
        if request.key in self.records:
            raise DEPLOY.RequestConflict("REQUEST_CONFLICT")
        self.records[request.key] = {
            "request": request.as_dict(),
            "status": "RUNNING",
            "phase": "accepted",
            "candidate_may_mutate": False,
        }
        return self.get(request.key)

    def update(self, key, **changes):
        self.records[key].update(changes)
        self.updates.append((key, dict(changes)))
        return self.get(key)

    def backup_path(self, key):
        return os.path.join(self.root, key + ".sqlite.backup")

    def diagnostic_path(self, key):
        return os.path.join(self.root, key + ".sqlite.failed")

    def candidate_override_path(self, key):
        return os.path.join(self.root, key + ".candidate.yml")


class FakeBackend(object):
    def __init__(self, database_path):
        self.database_path = database_path
        self.events = []
        self.failure = None
        self.rollback_failure = None
        self.lock_busy = False
        self.main_sha = SOURCE_SHA
        self.prior_image = "ghcr.io/etcetera-agency/omniroute@sha256:" + ("c" * 64)
        self.prior_image_id = "sha256:" + ("d" * 64)
        self.prior_override = b"services:\n  omniroute:\n    image: prior\n"
        self.app_identity = {"container_id": "app-container-1", "image_id": self.prior_image_id}
        self.redis = {"container_id": "redis-container-1", "image_id": "redis-image-1"}
        self._prior = None
        self.candidate_mutates_database = True
        self.app_running = True
        self.rollback_hash_before_start = None
        self.restored_backup_hash = None
        self.migration_coverage_ok = True
        self.backup_migration_coverage_ok = True
        self.validation_calls = []

    @contextlib.contextmanager
    def transaction_lock(self):
        self.events.append("lock")
        if self.lock_busy:
            raise DEPLOY.DeployError("LOCK_BUSY")
        yield

    def pull_and_verify(self, image_ref, request, config):
        self.events.append(("pull_and_verify", image_ref))
        if self.failure == "pull":
            raise DEPLOY.DeployError("IMAGE_PULL_FAILED")

    def validate_compose(self, config, request, image_ref):
        self.events.append("compose_preflight")
        if self.failure == "compose_preflight":
            raise DEPLOY.DeployError("COMPOSE_INVALID")
        self._prior = {
            "prior_image": self.prior_image,
            "prior_image_id": self.prior_image_id,
            "prior_override": self.prior_override,
            "app_identity": dict(self.app_identity),
            "redis_identity": dict(self.redis),
            "db_mode": 0o644,
            "db_uid": 1000,
            "db_gid": 1000,
        }
        return self._prior

    def current_main_sha(self):
        self.events.append("main_check")
        if self.failure == "main_api":
            raise DEPLOY.DeployError("GITHUB_MAIN_UNAVAILABLE")
        return self.main_sha

    def assert_redis_unchanged(self, prior, config):
        self.events.append("check_redis")
        if self.failure == "redis_changed_before_cutover" and self.events.count("check_redis") == 1:
            self.redis["container_id"] = "unexpected-redis"
        if self.redis != prior["redis_identity"]:
            raise DEPLOY.DeployError("REDIS_CHANGED")

    def assert_app_unchanged(self, prior, config):
        self.events.append("check_app")
        if self.failure == "app_changed_before_cutover" and self.events.count("check_app") == 1:
            self.app_identity["container_id"] = "unexpected-app"
        if self.app_identity != prior["app_identity"]:
            raise DEPLOY.DeployError("APP_CHANGED")

    def stop_app(self):
        self.events.append("stop_app")
        self.app_running = False
        if self.failure == "stop_app":
            raise DEPLOY.DeployError("APP_STOP_FAILED")

    def create_backup(self, backup_path):
        self.events.append("backup")
        if self.failure == "backup":
            raise DEPLOY.DeployError("BACKUP_FAILED")
        self.backup_migration_coverage_ok = self.migration_coverage_ok
        with open(backup_path, "wb") as handle:
            handle.write(b"online-sqlite-backup:")
            with open(self.database_path, "rb") as database:
                shutil.copyfileobj(database, handle)

    def hash_file(self, path):
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(65536), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def secure_backup(self, path):
        os.chmod(path, 0o600)

    def validate_database(self, path, image_ref, config, live, require_migration_coverage):
        self.events.append(("validate_database", image_ref))
        self.validation_calls.append((path, live, require_migration_coverage))
        if require_migration_coverage and not self.migration_coverage_ok:
            raise DEPLOY.DeployError("MIGRATION_COVERAGE_INVALID")
        if self.failure == "backup_validation" and path.endswith(".backup"):
            raise DEPLOY.DeployError("BACKUP_INVALID")
        if self.failure == "rollback_db_validation" and path == self.database_path:
            raise DEPLOY.DeployError("ROLLBACK_DB_INVALID")

    def set_candidate_override(self, path, image_ref, config):
        self.events.append(("candidate_override", image_ref))
        if self.failure == "candidate_override":
            raise DEPLOY.DeployError("OVERRIDE_WRITE_FAILED")

    def start_candidate(self, path, image_ref, config):
        self.events.append(("start_candidate", image_ref))
        self.app_running = True
        if self.candidate_mutates_database:
            with open(self.database_path, "ab") as handle:
                handle.write(b"-candidate-migration-write")
            self.migration_coverage_ok = True
        if self.failure == "candidate_start":
            raise DEPLOY.DeployError("CANDIDATE_START_FAILED")

    def accept_candidate(self, image_ref, config, prior, deadline):
        self.events.append(("accept_candidate", image_ref))
        if self.failure == "candidate_health":
            raise DEPLOY.DeployError("CANDIDATE_HEALTH_FAILED")
        if self.failure == "candidate_acceptance":
            raise DEPLOY.DeployError("CANDIDATE_REJECTED")
        if self.failure == "redis_changed":
            self.redis["container_id"] = "unexpected-redis"
        self.assert_redis_unchanged(self._prior, config)

    def health_budget(self, config):
        return 205

    def persist_candidate_override(self, image_ref, config):
        self.events.append(("persist_candidate_override", image_ref))
        if self.failure == "persist_override":
            raise DEPLOY.DeployError("OVERRIDE_COMMIT_FAILED")

    def preserve_failed_database(self, destination, config):
        self.events.append("preserve_failed_database")
        if self.failure == "diagnostic_copy":
            raise DEPLOY.DeployError("DIAGNOSTIC_COPY_FAILED")
        shutil.copyfile(self.database_path, destination)
        return self.hash_file(destination)

    def clear_database_sidecars(self, config):
        self.events.append("clear_wal_shm")
        for suffix in ("-wal", "-shm"):
            path = self.database_path + suffix
            if os.path.exists(path):
                os.unlink(path)

    def restore_database(self, backup_path, config, metadata):
        self.events.append("restore_database")
        if self.failure == "restore_database":
            raise DEPLOY.DeployError("DB_RESTORE_FAILED")
        temporary = self.database_path + ".restore"
        shutil.copyfile(backup_path, temporary)
        os.chmod(temporary, metadata["db_mode"])
        os.replace(temporary, self.database_path)
        self.migration_coverage_ok = self.backup_migration_coverage_ok
        self.restored_backup_hash = self.hash_file(backup_path)
        self.rollback_hash_before_start = self.hash_file(self.database_path)

    def restore_prior_override(self, override_bytes, config):
        self.events.append("restore_prior_override")
        if self.failure == "restore_override":
            raise DEPLOY.DeployError("OVERRIDE_RESTORE_FAILED")

    def assert_image_id(self, image_ref, expected_id):
        self.events.append(("assert_image_id", image_ref, expected_id))

    def start_prior_image(self, image_ref, config):
        self.events.append(("start_prior", image_ref))
        if self.failure == "rollback_start":
            raise DEPLOY.DeployError("ROLLBACK_START_FAILED")
        self.app_running = True
        self.migration_coverage_ok = True

    def verify_prior_service(self, image_ref, config, deadline):
        self.events.append(("verify_prior", image_ref))
        self.assert_redis_unchanged(self._prior, config)
        self.validate_database(
            self.database_path,
            image_ref,
            config,
            live=True,
            require_migration_coverage=True,
        )
        if self.rollback_failure == "rollback_health":
            raise DEPLOY.DeployError("ROLLBACK_HEALTH_FAILED")


class DeployRequestTests(unittest.TestCase):
    def test_accepts_exact_four_field_record_and_constructs_fixed_image(self):
        request = DEPLOY.parse_request(VALID_RECORD)

        self.assertEqual(request.digest, DIGEST)
        self.assertEqual(request.source_sha, SOURCE_SHA)
        self.assertEqual(request.run_id, RUN_ID)
        self.assertEqual(request.attempt, ATTEMPT)
        self.assertEqual(request.key, KEY)
        self.assertEqual(
            request.image_ref,
            "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
        )

    def test_rejects_extra_lines_bytes_and_hostile_fields(self):
        invalid_records = [
            VALID_RECORD + b"\n",
            VALID_RECORD + b"x",
            VALID_RECORD.rstrip(b"\n"),
            VALID_RECORD.replace(b" " + SOURCE_SHA.encode("ascii"), b"\n" + SOURCE_SHA.encode("ascii")),
            VALID_RECORD.replace(b" " + RUN_ID.encode("ascii"), b" $(touch /tmp/pwned) " + RUN_ID.encode("ascii")),
            VALID_RECORD.replace(DIGEST.encode("ascii"), b"sha256:" + b"A" * 64),
            VALID_RECORD.replace(ATTEMPT.encode("ascii"), b"0"),
            ("%s %s %s %s\r\n" % (DIGEST, SOURCE_SHA, RUN_ID, ATTEMPT)).encode("ascii"),
            ("%s %s %s %s extra\n" % (DIGEST, SOURCE_SHA, RUN_ID, ATTEMPT)).encode("ascii"),
        ]

        for record in invalid_records:
            with self.subTest(record=record):
                with self.assertRaises(DEPLOY.InvalidRequest):
                    DEPLOY.parse_request(record)

    def test_run_and_attempt_are_bounded_positive_decimal_strings(self):
        for run_id, attempt in (("0", "1"), ("1", "0"), ("1" * 21, "1"), ("1", "1" * 11)):
            record = ("%s %s %s %s\n" % (DIGEST, SOURCE_SHA, run_id, attempt)).encode("ascii")
            with self.subTest(run_id=run_id, attempt=attempt):
                with self.assertRaises(DEPLOY.InvalidRequest):
                    DEPLOY.parse_request(record)


class EntrypointOutputTests(unittest.TestCase):
    def _run_main(self, argv, state):
        request = DEPLOY.parse_request(VALID_RECORD)
        output = io.StringIO()
        with patch.object(DEPLOY.os, "geteuid", return_value=0), \
                patch.object(DEPLOY, "_read_stdin_request", return_value=request), \
                patch.object(DEPLOY, "_load_runtime_config", return_value={}), \
                patch.object(DEPLOY, "_execute_submit", return_value=state), \
                patch.object(DEPLOY.sys, "stdout", output):
            result = DEPLOY.main(argv)
        return result, output.getvalue()

    def test_production_entrypoint_formats_success_and_failure_with_transaction_key(self):
        cases = (
            ({"status": "SUCCEEDED"}, 0, "SUCCEEDED %s\n" % KEY),
            ({"status": "FAILED", "code": "HEALTH_CHECK_FAILED"}, 1, "FAILED %s HEALTH_CHECK_FAILED\n" % KEY),
        )
        for state, expected_exit, expected_output in cases:
            with self.subTest(status=state["status"]):
                result, output = self._run_main([], state)
                self.assertEqual((result, output), (expected_exit, expected_output))

    def test_fixture_entrypoint_formats_success_and_failure_with_transaction_key(self):
        cases = (
            ({"status": "SUCCEEDED"}, 0, "SUCCEEDED %s\n" % KEY),
            ({"status": "FAILED", "code": "HEALTH_CHECK_FAILED"}, 1, "FAILED %s HEALTH_CHECK_FAILED\n" % KEY),
        )
        for state, expected_exit, expected_output in cases:
            with self.subTest(status=state["status"]):
                result, output = self._run_main(["--config", "/fixture/config.json"], state)
                self.assertEqual((result, output), (expected_exit, expected_output))


class GateTests(unittest.TestCase):
    def test_gate_calls_only_fixed_no_argument_launcher_for_valid_request(self):
        calls = []
        stdout = io.BytesIO()
        stderr = io.BytesIO()

        def execute(argv, payload):
            calls.append((argv, payload))
            return 0, ("SUCCEEDED %s\n" % KEY).encode("ascii"), b"ignored root stderr"

        result = DEPLOY.run_ssh_gate("deploy-main", VALID_RECORD, execute, stdout, stderr)

        self.assertEqual(result, 0)
        self.assertEqual(calls, [(["/usr/bin/sudo", "-n", "/usr/local/sbin/omniroute-deploy"], VALID_RECORD)])
        self.assertEqual(stdout.getvalue(), ("SUCCEEDED %s\n" % KEY).encode("ascii"))
        self.assertEqual(stderr.getvalue(), b"")

    def test_gate_rejects_wrong_command_or_malformed_payload_before_sudo(self):
        calls = []
        for command, payload in (("id", VALID_RECORD), ("deploy-main", VALID_RECORD + b"x")):
            stdout = io.BytesIO()
            stderr = io.BytesIO()
            with self.subTest(command=command, payload=payload):
                result = DEPLOY.run_ssh_gate(command, payload, lambda *args: calls.append(args), stdout, stderr)
                self.assertNotEqual(result, 0)
                self.assertEqual(calls, [])
                self.assertNotIn(b"x", stdout.getvalue())
                self.assertNotIn(b"id", stderr.getvalue())

    def test_gate_rejects_unbounded_root_output(self):
        stdout = io.BytesIO()
        stderr = io.BytesIO()
        result = DEPLOY.run_ssh_gate(
            "deploy-main",
            VALID_RECORD,
            lambda argv, payload: (0, b"secret" * 1000, b"private error"),
            stdout,
            stderr,
        )
        self.assertNotEqual(result, 0)
        self.assertNotIn(b"secret", stdout.getvalue())
        self.assertNotIn(b"private", stderr.getvalue())


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="omniroute-deploy-test-")
        self.root = self.temporary.name
        self.database_path = os.path.join(self.root, "storage.sqlite")
        with open(self.database_path, "wb") as handle:
            handle.write(b"fixture-production-format-db")
        self.store = FakeStore(self.root)
        self.backend = FakeBackend(self.database_path)
        self.config = {
            "profile": "test",
            "state_root": self.root,
            "backup_root": self.root,
            "database_path": self.database_path,
            "transaction_budget_seconds": 300,
        }
        self.request = DEPLOY.parse_request(VALID_RECORD)

    def tearDown(self):
        self.temporary.cleanup()

    def test_success_only_changes_app_and_commits_digest_after_acceptance(self):
        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "SUCCEEDED")
        candidate_start = next(index for index, event in enumerate(self.backend.events) if isinstance(event, tuple) and event[0] == "start_candidate")
        self.assertLess(self.backend.events.index("check_app"), self.backend.events.index("stop_app"))
        self.assertLess(self.backend.events.index("backup"), candidate_start)
        candidate_acceptance = next(index for index, event in enumerate(self.backend.events) if isinstance(event, tuple) and event[0] == "accept_candidate")
        self.assertLess(
            candidate_acceptance,
            self.backend.events.index(("persist_candidate_override", self.request.image_ref)),
        )
        redis_checks = [index for index, event in enumerate(self.backend.events) if event == "check_redis"]
        self.assertEqual(len(redis_checks), 3)
        self.assertLess(redis_checks[0], self.backend.events.index("stop_app"))
        self.assertGreater(redis_checks[1], candidate_acceptance)
        self.assertGreater(redis_checks[2], self.backend.events.index(("persist_candidate_override", self.request.image_ref)))
        self.assertNotIn("stop_redis", self.backend.events)
        self.assertFalse(any("redis" in str(event).lower() for event in self.backend.events if event in ("stop_app",)))
        self.assertEqual(self.store.get(KEY)["status"], "SUCCEEDED")

    def test_stale_source_skips_before_app_database_or_override_mutation(self):
        self.backend.main_sha = "e" * 40
        with open(self.database_path, "rb") as handle:
            before = handle.read()

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "SKIPPED_STALE")
        with open(self.database_path, "rb") as handle:
            self.assertEqual(handle.read(), before)
        self.assertNotIn("stop_app", self.backend.events)
        self.assertNotIn("backup", self.backend.events)
        self.assertNotIn("start_candidate", self.backend.events)

    def test_fixture_expected_sha_never_overrides_an_available_main_mismatch(self):
        self.config.update(profile="fixture", fixture_expected_source_sha=SOURCE_SHA)
        self.backend.main_sha = "e" * 40

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "SKIPPED_STALE")
        self.assertNotIn("stop_app", self.backend.events)

    def test_fixture_expected_sha_is_only_a_fallback_when_main_api_is_unavailable(self):
        self.config.update(profile="fixture", fixture_expected_source_sha=SOURCE_SHA)
        self.backend.failure = "main_api"

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertIn("stop_app", self.backend.events)

    def test_pull_and_compose_preflight_fail_before_app_mutation(self):
        for failure, expected_code in (("pull", "IMAGE_PULL_FAILED"), ("compose_preflight", "COMPOSE_INVALID")):
            with self.subTest(failure=failure):
                self.backend.failure = failure
                result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)
                self.assertEqual(result["status"], "FAILED")
                self.assertEqual(result["code"], expected_code)
                self.assertNotIn("stop_app", self.backend.events)
                self.assertNotIn("backup", self.backend.events)
                self.backend.failure = None
                self.backend.events = []
                self.store.records = {}

    def test_redis_change_before_cutover_fails_before_stopping_the_app(self):
        self.backend.failure = "redis_changed_before_cutover"

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "REDIS_CHANGED")
        self.assertNotIn("stop_app", self.backend.events)
        self.assertNotIn("backup", self.backend.events)

    def test_app_container_replacement_before_cutover_fails_without_mutation(self):
        self.backend.failure = "app_changed_before_cutover"

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "APP_CHANGED")
        self.assertNotIn("stop_app", self.backend.events)
        self.assertNotIn("backup", self.backend.events)

    def test_backup_failure_restarts_prior_without_database_restore(self):
        self.backend.failure = "backup"
        with open(self.database_path, "rb") as handle:
            before = handle.read()

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "BACKUP_FAILED")
        self.assertIn(("start_prior", self.backend.prior_image), self.backend.events)
        self.assertNotIn("restore_database", self.backend.events)
        self.assertNotIn("start_candidate", self.backend.events)
        with open(self.database_path, "rb") as handle:
            self.assertEqual(handle.read(), before)
        self.assertTrue(self.backend.app_running)

    def test_stop_timeout_after_daemon_stops_still_restarts_prior_image(self):
        self.backend.failure = "stop_app"

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        journal = self.store.get(KEY)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "APP_STOP_FAILED")
        self.assertTrue(journal["app_stop_attempted"])
        self.assertIn(("start_prior", self.backend.prior_image), self.backend.events)
        self.assertTrue(self.backend.app_running)
        self.assertNotIn("restore_database", self.backend.events)

    def test_candidate_override_failure_restarts_prior_without_database_restore(self):
        self.backend.failure = "candidate_override"
        with open(self.database_path, "rb") as handle:
            before = handle.read()

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "OVERRIDE_WRITE_FAILED")
        self.assertIn(("start_prior", self.backend.prior_image), self.backend.events)
        self.assertNotIn("start_candidate", self.backend.events)
        self.assertNotIn("restore_database", self.backend.events)
        with open(self.database_path, "rb") as handle:
            self.assertEqual(handle.read(), before)

    def test_persisted_override_failure_restores_candidate_database(self):
        self.backend.failure = "persist_override"

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        journal = self.store.get(KEY)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "OVERRIDE_COMMIT_FAILED")
        self.assertTrue(journal["rollback_succeeded"])
        self.assertEqual(self.backend.rollback_hash_before_start, journal["backup_sha256"])
        self.assertIn("restore_database", self.backend.events)

    def test_interrupted_candidate_transaction_recovers_from_durable_journal(self):
        state = self.store.create(self.request)
        prior = self.backend.validate_compose(self.config, self.request, self.request.image_ref)
        backup_path = self.store.backup_path(KEY)
        self.backend.create_backup(backup_path)
        self.backend.secure_backup(backup_path)
        backup_hash = self.backend.hash_file(backup_path)
        with open(self.database_path, "ab") as handle:
            handle.write(b"-committed-candidate-migration")
        self.store.update(
            KEY,
            phase="candidate_started",
            prior_state=DEPLOY._safe_prior_state(prior),
            candidate_may_mutate=True,
            backup_path=backup_path,
            backup_sha256=backup_hash,
            db_metadata={"db_uid": 1000, "db_gid": 1000, "db_mode": 0o644},
        )

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "PROCESS_INTERRUPTED")
        self.assertTrue(result["rollback_succeeded"])
        self.assertEqual(self.backend.rollback_hash_before_start, backup_hash)
        self.assertIn(("start_prior", self.backend.prior_image), self.backend.events)

    def test_candidate_start_error_after_possible_migration_restores_backup(self):
        self.backend.failure = "candidate_start"

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        journal = self.store.get(KEY)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "CANDIDATE_START_FAILED")
        self.assertTrue(journal["candidate_may_mutate"])
        self.assertEqual(self.backend.rollback_hash_before_start, journal["backup_sha256"])
        self.assertIn("restore_database", self.backend.events)

    def test_candidate_failure_restores_online_backup_hash_before_old_start(self):
        self.backend.failure = "candidate_health"
        with open(self.database_path, "rb") as handle:
            before = handle.read()

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        journal = self.store.get(KEY)
        backup_hash = self.backend.hash_file(self.store.backup_path(KEY))
        self.assertEqual(result["status"], "FAILED")
        self.assertTrue(journal["candidate_may_mutate"])
        self.assertTrue(journal["rollback_succeeded"])
        self.assertEqual(self.backend.rollback_hash_before_start, backup_hash)
        self.assertEqual(journal["restored_db_sha256"], backup_hash)
        self.assertNotEqual(backup_hash, hashlib.sha256(before).hexdigest())
        with open(self.database_path, "rb") as handle:
            self.assertEqual(handle.read(), b"online-sqlite-backup:" + before)
        self.assertTrue(os.path.exists(self.store.diagnostic_path(KEY)))
        self.assertLess(self.backend.events.index("preserve_failed_database"), self.backend.events.index("restore_database"))
        self.assertLess(self.backend.events.index("clear_wal_shm"), self.backend.events.index("restore_database"))
        self.assertLess(self.backend.events.index("restore_database"), self.backend.events.index(("start_prior", self.backend.prior_image)))
        self.assertNotIn("stop_redis", self.backend.events)
        self.assertGreater(
            max(index for index, event in enumerate(self.backend.events) if event == "check_redis"),
            self.backend.events.index(("verify_prior", self.backend.prior_image)),
        )

    def test_redis_change_during_candidate_acceptance_fails_closed_on_rollback(self):
        self.backend.failure = "redis_changed"

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "ROLLBACK_FAILED")
        self.assertFalse(result["rollback_succeeded"])
        self.assertIn("restore_database", self.backend.events)
        self.assertFalse(self.backend.app_running)

    def test_pending_migration_backup_and_restore_are_checked_before_old_image_reapplies(self):
        self.backend.failure = "candidate_health"
        self.backend.migration_coverage_ok = False

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertTrue(result["rollback_succeeded"])
        self.assertEqual(self.backend.validation_calls[0][2], False)
        self.assertEqual(self.backend.validation_calls[1][2], False)
        self.assertEqual(self.backend.validation_calls[-1][2], True)
        self.assertIn(("start_prior", self.backend.prior_image), self.backend.events)

    def test_lock_contention_fails_before_pull_or_compose(self):
        self.backend.lock_busy = True

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "LOCK_BUSY")
        self.assertEqual(self.backend.events, ["lock"])

    def test_rollback_failure_leaves_app_stopped_and_artifacts_preserved(self):
        self.backend.failure = "candidate_health"
        self.backend.rollback_failure = "rollback_health"

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "ROLLBACK_FAILED")
        self.assertFalse(self.backend.app_running)
        self.assertTrue(os.path.exists(self.store.backup_path(KEY)))
        self.assertTrue(os.path.exists(self.store.diagnostic_path(KEY)))

    def test_diagnostic_preservation_failure_blocks_destructive_restore(self):
        self.backend.failure = "diagnostic_copy"
        self.backend.candidate_mutates_database = True

        def reject_candidate(*_args):
            raise DEPLOY.DeployError("CANDIDATE_HEALTH_FAILED")

        self.backend.accept_candidate = reject_candidate

        result = DEPLOY.run_transaction(self.request, self.config, self.backend, self.store)

        journal = self.store.get(KEY)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "ROLLBACK_FAILED")
        self.assertTrue(journal["diagnostic_copy_failed"])
        self.assertFalse(journal["rollback_succeeded"])
        self.assertFalse(self.backend.app_running)
        self.assertNotIn("clear_wal_shm", self.backend.events)
        self.assertNotIn("restore_database", self.backend.events)
        self.assertNotIn(("start_prior", self.backend.prior_image), self.backend.events)
        self.assertTrue(os.path.exists(self.store.backup_path(KEY)))
        with open(self.database_path, "rb") as handle:
            self.assertTrue(handle.read().endswith(b"-candidate-migration-write"))


class RequestReattachmentTests(unittest.TestCase):
    def test_disconnect_then_same_tuple_reattaches_without_second_launch(self):
        request = DEPLOY.parse_request(VALID_RECORD)
        store = FakeStore(tempfile.gettempdir())

        class Units(object):
            def __init__(self):
                self.starts = []
                self.active = set()
                self.interrupt_once = True

            def is_active(self, key):
                return key in self.active

            def start(self, key, config_path):
                self.starts.append((key, config_path))
                self.active.add(key)

            def wait(self, key, state_store, config_path):
                if self.interrupt_once:
                    self.interrupt_once = False
                    raise KeyboardInterrupt()
                result = state_store.update(key, status="SUCCEEDED", phase="complete")
                self.active.remove(key)
                return result

        units = Units()
        with self.assertRaises(KeyboardInterrupt):
            DEPLOY.submit_request(request, {"_config_path": "/etc/omniroute-deploy/production.json"}, store, units)

        result = DEPLOY.submit_request(request, {"_config_path": "/etc/omniroute-deploy/production.json"}, store, units)

        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(len(units.starts), 1)
        self.assertEqual(store.get(KEY)["request"], request.as_dict())

    def test_same_key_with_different_tuple_conflicts_but_new_attempt_is_distinct(self):
        request = DEPLOY.parse_request(VALID_RECORD)
        store = FakeStore(tempfile.gettempdir())
        store.create(request)
        conflicting = DEPLOY.parse_request(("%s %s %s %s\n" % ("sha256:" + "f" * 64, SOURCE_SHA, RUN_ID, ATTEMPT)).encode("ascii"))

        with self.assertRaises(DEPLOY.RequestConflict):
            DEPLOY.submit_request(conflicting, {}, store, None)

        rerun = DEPLOY.parse_request(("%s %s %s %s\n" % (DIGEST, SOURCE_SHA, RUN_ID, "3")).encode("ascii"))
        self.assertNotEqual(rerun.key, request.key)

    def test_unit_relaunch_or_wait_failure_keeps_post_stop_journal_retryable(self):
        request = DEPLOY.parse_request(VALID_RECORD)
        for failed_step in ("start", "wait"):
            with self.subTest(failed_step=failed_step):
                store = FakeStore(tempfile.gettempdir())
                store.create(request)
                store.update(
                    request.key,
                    phase="candidate_started",
                    app_stop_attempted=True,
                    candidate_may_mutate=True,
                )

                class FailedUnits(object):
                    def is_active(self, key):
                        return failed_step == "wait"

                    def start(self, key, config_path):
                        raise DEPLOY.DeployError("SYSTEMD_START_FAILED")

                    def wait(self, key, state_store, config_path):
                        raise DEPLOY.DeployError("SYSTEMD_WAIT_FAILED")

                with self.assertRaises(DEPLOY.DeployError):
                    DEPLOY.submit_request(request, {}, store, FailedUnits())

                journal = store.get(request.key)
                self.assertEqual(journal["status"], "RUNNING")
                self.assertTrue(journal["candidate_may_mutate"])


class FixtureConfigTests(unittest.TestCase):
    def test_fixture_config_rejects_published_ports_and_requires_loopback_proxy_url(self):
        root = "/opt/apps/omniroute-deploy-rehearsals/cd-fixture-20261003T213651Z"
        config = {
            "profile": "fixture",
            "fixture_root": root,
            "compose_project_name": "omniroute-cd-fixture-20261003t213651z",
            "compose_files": [
                root + "/compose/base.yml",
                root + "/compose/candidate.yml",
                root + "/compose/browser.yml",
                root + "/compose/image.yml",
            ],
            "project_dir": root,
            "data_dir": root + "/dbdata",
            "database_path": root + "/dbdata/storage.sqlite",
            "image_override_path": root + "/compose/image.yml",
            "state_root": root + "/status",
            "backup_root": root + "/transactions",
            "candidate_root": root + "/transactions",
            "lock_path": root + "/lock/transaction.lock",
            "migration_catalog_path": DEPLOY.CATALOG_PATH,
            "app_service": "omniroute",
            "redis_service": "redis",
            "app_container": "omniroute-cd-fixture-app",
            "redis_container": "omniroute-cd-fixture-redis",
            "public_dashboard_url": "http://127.0.0.1:30128/dashboard/radar",
        }

        DEPLOY.validate_fixture_config(config)

        config["published_port_hosts"] = ["127.0.0.1"]
        with self.assertRaises(DEPLOY.ConfigurationError):
            DEPLOY.validate_fixture_config(config)
        del config["published_port_hosts"]

        for invalid_url in (
            "https://127.0.0.1:30128/dashboard/radar",
            "http://localhost:30128/dashboard/radar",
            "http://127.0.0.1/dashboard/radar",
            "http://127.0.0.1:0/dashboard/radar",
            "http://127.0.0.1:65536/dashboard/radar",
            "http://127.0.0.1:30128/not-found",
            "http://127.0.0.1:30128/dashboard/radar?x=1",
        ):
            with self.subTest(public_dashboard_url=invalid_url):
                config["public_dashboard_url"] = invalid_url
                with self.assertRaises(DEPLOY.ConfigurationError):
                    DEPLOY.validate_fixture_config(config)
        config["public_dashboard_url"] = "http://127.0.0.1:30128/dashboard/radar"

        config["dashboard_url"] = "http://127.0.0.1:30129/"
        with self.assertRaises(DEPLOY.ConfigurationError):
            DEPLOY.validate_fixture_config(config)
        del config["dashboard_url"]

        config["database_path"] = "/opt/apps/omniroute/data/storage.sqlite"
        with self.assertRaises(DEPLOY.ConfigurationError):
            DEPLOY.validate_fixture_config(config)

    def test_config_file_requires_root_owner_and_mode_0600(self):
        fake_stat = type("Stat", (), {"st_uid": 1000, "st_mode": 0o100600})()

        with self.assertRaises(DEPLOY.ConfigurationError):
            DEPLOY.require_root_mode_0600("/fixture.json", stat_result=fake_stat, current_uid=0)

        fake_stat = type("Stat", (), {"st_uid": 0, "st_mode": 0o100644})()
        with self.assertRaises(DEPLOY.ConfigurationError):
            DEPLOY.require_root_mode_0600("/fixture.json", stat_result=fake_stat, current_uid=0)


class DockerBackendSafetyTests(unittest.TestCase):
    def setUp(self):
        self.root = "/opt/apps/omniroute-deploy-rehearsals/cd-fixture-20261003T213651Z"
        self.config = {
            "profile": "fixture",
            "fixture_root": self.root,
            "app_service": "omniroute",
            "redis_service": "redis",
            "app_container": "omniroute-cd-fixture-app",
            "redis_container": "omniroute-cd-fixture-redis",
            "data_dir": self.root + "/dbdata",
            "public_dashboard_url": "http://127.0.0.1:30128/dashboard/radar",
        }

    def test_fixture_allows_internal_browser_service_and_rejects_public_or_external_paths(self):
        rendered = {
            "services": {
                "omniroute": {
                    "container_name": self.config["app_container"],
                    "volumes": [
                        {"type": "bind", "source": self.config["data_dir"], "target": "/app/data"},
                    ],
                },
                "redis": {"container_name": self.config["redis_container"]},
                "browser": {"container_name": "omniroute-cd-fixture-browser"},
            },
            "networks": {"default": {"internal": True}},
        }
        backend = DEPLOY.DockerBackend.__new__(DEPLOY.DockerBackend)

        backend._validate_rendered_paths(self.config, rendered)

        self.assertEqual(
            DEPLOY._compose_networks(
                {"networks": {"default": {}}}, rendered, "fixture"
            ),
            {"fixture_default"},
        )

        public_port = {
            "services": dict(rendered["services"]),
            "networks": rendered["networks"],
        }
        public_port["services"]["browser"] = {
            "container_name": "omniroute-cd-fixture-browser",
            "ports": [{"host_ip": "0.0.0.0", "published": "9223"}],
        }
        with self.assertRaises(DEPLOY.DeployError):
            backend._validate_rendered_paths(self.config, public_port)

        app_port = copy.deepcopy(rendered)
        app_port["services"]["omniroute"]["ports"] = [
            {"target": 20129, "published": "37707", "host_ip": "127.0.0.1", "mode": "ingress"}
        ]
        with self.assertRaises(DEPLOY.DeployError):
            backend._validate_rendered_paths(self.config, app_port)

        redis_port = copy.deepcopy(rendered)
        redis_port["services"]["redis"]["ports"] = [
            {"target": 6379, "published": "36379", "host_ip": "127.0.0.1", "mode": "ingress"}
        ]
        with self.assertRaises(DEPLOY.DeployError):
            backend._validate_rendered_paths(self.config, redis_port)


    def test_stop_app_checks_daemon_after_compose_timeout_then_uses_fixed_docker_stop(self):
        request = DEPLOY.parse_request(VALID_RECORD)
        backend = DEPLOY.DockerBackend(self.config, request, None)
        backend._compose_command = lambda _config: ["/usr/bin/docker", "compose"]
        states = iter((
            {"State": {"Running": True}},
            {"State": {"Running": False}},
        ))
        backend._inspect_container = lambda _name: next(states)

        with patch.object(
            DEPLOY,
            "_run_command",
            side_effect=(DEPLOY.DeployError("APP_STOP_FAILED"), None),
        ) as run_command:
            backend.stop_app()

        self.assertEqual(run_command.call_args_list[1][0][0], ["/usr/bin/docker", "stop", "--time", "45", self.config["app_container"]])

    def test_pre_migration_backup_allows_pending_coverage_when_integrity_and_foreign_keys_pass(self):
        backend = DEPLOY.DockerBackend.__new__(DEPLOY.DockerBackend)
        backend._database_report = lambda *_args, **_kwargs: {
            "integrityOk": True,
            "foreignKeyViolationCount": 0,
            "migrationCoverageOk": False,
        }

        backend.validate_database(
            "/fixture/pre-deploy.sqlite",
            "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
            self.config,
            live=False,
            require_migration_coverage=False,
        )

        with self.assertRaises(DEPLOY.DeployError):
            backend.validate_database(
                "/fixture/pre-deploy.sqlite",
                "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
                self.config,
                live=False,
                require_migration_coverage=True,
            )

    def _runtime_projection_fixture(self, service_name="omniroute"):
        project = "omniroute-cd-fixture-20261003t213651z"
        is_app = service_name == self.config["app_service"]
        container_name = self.config["app_container"] if is_app else self.config["redis_container"]
        image_ref = "ghcr.io/example/%s@sha256:%s" % ("omniroute" if is_app else "redis", "a" * 64)
        image_id = "sha256:" + ("b" * 64)
        default_networks = {
            "data": {"name": "fixture-data", "external": True, "ipam": {}},
            "internal": {"name": "fixture-internal", "external": True, "ipam": {}},
            "omniroute-private": {"name": project + "_private", "driver": "bridge", "ipam": {}},
            "proxy": {"name": "fixture-proxy", "external": True, "ipam": {}},
        }
        networks = {
            "data": {},
            "internal": {},
            "omniroute-private": {},
            "proxy": {},
        } if is_app else {"internal": {}, "omniroute-private": {}}
        health_test = ["CMD", "node", "healthcheck.mjs"] if is_app else ["CMD", "redis-cli", "ping"]
        data_dir = self.config["data_dir"] if is_app else os.path.join(self.config["fixture_root"], "redis-data")
        target = "/app/data" if is_app else "/data"
        healthcheck = {
            "test": health_test,
            "interval": "30s",
            "timeout": "5s",
            "retries": 3,
        }
        if is_app:
            healthcheck["start_period"] = "15s"
        image_labels = ({
            "org.opencontainers.image.source": "https://github.com/example/omniroute",
            "org.opencontainers.image.revision": "c" * 40,
        } if is_app else {})
        service_labels = {"example.user-label": "kept"} if is_app else {}
        service = {
            "container_name": container_name,
            "image": image_ref,
            "environment": {"DATA_DIR": target, "ENV_FILE_SECRET": "secret-from-root-env-file"} if is_app else None,
            "command": None if is_app else ["redis-server", "--save", "60", "1", "--loglevel", "warning"],
            "entrypoint": None,
            "user": None,
            "working_dir": None,
            "init": True if is_app else None,
            "restart": "unless-stopped",
            "healthcheck": healthcheck,
            "ports": [],
            "volumes": [{"type": "bind", "source": data_dir, "target": target, "read_only": False}],
            "networks": networks,
            "labels": service_labels,
        }
        model = {
            "services": {service_name: service},
            "networks": {name: definition for name, definition in default_networks.items() if name in networks},
            "volumes": {},
        }
        runtime_config = dict(self.config)
        runtime_config["compose_project_name"] = project
        image = {
            "Id": image_id,
            "Config": {
                "Env": ["PATH=/usr/bin", "IMAGE_DEFAULT=from-image"] if is_app else ["PATH=/usr/bin"],
                "Cmd": ["node", "server.js"] if is_app else ["redis-server", "image-default.conf"],
                "Entrypoint": ["docker-entrypoint.sh", "node"] if is_app else ["docker-entrypoint.sh"],
                "User": "node",
                "WorkingDir": "/app" if is_app else "",
                "Labels": image_labels,
                "Healthcheck": None,
                "ExposedPorts": {"20128/tcp": {}, "20129/tcp": {}} if is_app else {"6379/tcp": {}},
            },
        }
        labels = dict(image["Config"]["Labels"])
        labels.update(service["labels"])
        labels.update({
            "com.docker.compose.project": project,
            "com.docker.compose.service": service_name,
            "com.docker.compose.version": "2.27.0",
            "com.docker.compose.config-hash": "unreliable",
            "com.docker.compose.project.config_files": "/old/path/compose.yml",
        })
        ports = {}
        native_healthcheck = {
            "Test": health_test,
            "Interval": 30000000000,
            "Timeout": 5000000000,
            "Retries": 3,
        }
        if is_app:
            native_healthcheck["StartPeriod"] = 15000000000
        container = {
            "Id": "c" * 64,
            "Name": "/" + container_name,
            "Image": image_id,
            "State": {"Status": "running", "Running": True, "Health": {"Status": "healthy"}},
            "Config": {
                "Image": image_ref,
                "Env": (
                    ["PATH=/usr/bin", "IMAGE_DEFAULT=from-image", "DATA_DIR=/app/data", "ENV_FILE_SECRET=secret-from-root-env-file"]
                    if is_app else ["PATH=/usr/bin"]
                ),
                "Cmd": list(image["Config"]["Cmd"] if service["command"] is None else service["command"]),
                "Entrypoint": list(image["Config"]["Entrypoint"]),
                "User": image["Config"]["User"],
                "WorkingDir": image["Config"]["WorkingDir"],
                "Healthcheck": native_healthcheck,
                "Labels": labels,
            },
            "HostConfig": {"Init": service["init"], "RestartPolicy": {"Name": "unless-stopped"}, "PortBindings": {}},
            "NetworkSettings": {"Ports": ports, "Networks": {definition["name"]: {} for name, definition in default_networks.items() if name in networks}},
            "Mounts": [{"Type": "bind", "Source": os.path.realpath(data_dir), "Destination": target, "RW": True, "Propagation": "rprivate", "Name": ""}],
        }
        return model, image, container, runtime_config

    def test_resolved_env_file_and_runtime_projection_match_baseline(self):
        model, image, container, runtime_config = self._runtime_projection_fixture()
        DEPLOY._assert_service_runtime_projection(
            self.config["app_service"], model, container, image, runtime_config
        )

    def test_internal_fixture_accepts_omitted_exposed_ports_but_rejects_bindings(self):
        model, image, container, runtime_config = self._runtime_projection_fixture()
        self.assertEqual(container["NetworkSettings"]["Ports"], {})

        DEPLOY._assert_service_runtime_projection(
            self.config["app_service"], model, container, image, runtime_config
        )

        container["NetworkSettings"]["Ports"] = {"20128/tcp": None, "20129/tcp": None}
        DEPLOY._assert_service_runtime_projection(
            self.config["app_service"], model, container, image, runtime_config
        )

        container["NetworkSettings"]["Ports"] = {
            "20129/tcp": [{"HostIp": "127.0.0.1", "HostPort": "37707"}]
        }
        container["HostConfig"]["PortBindings"] = {
            "20129/tcp": [{"HostIp": "127.0.0.1", "HostPort": "37707"}]
        }
        with self.assertRaises(DEPLOY.DeployError):
            DEPLOY._assert_service_runtime_projection(
                self.config["app_service"], model, container, image, runtime_config
            )

    def test_missing_native_redis_start_period_matches_compose_zero_default(self):
        model, image, redis, runtime_config = self._runtime_projection_fixture(self.config["redis_service"])
        native_healthcheck = redis["Config"]["Healthcheck"]
        self.assertNotIn("StartPeriod", native_healthcheck)

        DEPLOY._assert_service_runtime_projection(
            self.config["redis_service"], model, redis, image, runtime_config
        )

        for invalid_value in (None, -1, True, "0"):
            with self.subTest(start_period=invalid_value):
                native_healthcheck["StartPeriod"] = invalid_value
                with self.assertRaises(DEPLOY.DeployError):
                    DEPLOY._assert_service_runtime_projection(
                        self.config["redis_service"], model, redis, image, runtime_config
                    )

    def test_network_projection_rejects_nonboolean_internal_flag(self):
        for invalid in (None, 1, "true"):
            with self.subTest(internal=invalid):
                with self.assertRaises(DEPLOY.DeployError):
                    DEPLOY._compose_networks(
                        {"networks": {"default": {}}},
                        {"networks": {"default": {"internal": invalid}}},
                        "fixture",
                    )

    def test_empty_ipam_matches_live_networks_and_nonempty_ipam_is_rejected(self):
        model, image, container, runtime_config = self._runtime_projection_fixture()
        self.assertTrue(all(network["ipam"] == {} for network in model["networks"].values()))

        DEPLOY._assert_service_runtime_projection(
            self.config["app_service"], model, container, image, runtime_config
        )

        for network_name in model["networks"]:
            with self.subTest(network=network_name):
                model, image, container, runtime_config = self._runtime_projection_fixture()
                model["networks"][network_name]["ipam"] = {"config": []}
                with self.assertRaises(DEPLOY.DeployError):
                    DEPLOY._assert_service_runtime_projection(
                        self.config["app_service"], model, container, image, runtime_config
                    )

    def test_runtime_projection_rejects_environment_mount_port_network_and_redis_drift(self):
        def add_published_port(container):
            binding = [{"HostIp": "127.0.0.1", "HostPort": "30130"}]
            container["HostConfig"]["PortBindings"] = {"20129/tcp": binding}
            container["NetworkSettings"]["Ports"] = {"20129/tcp": binding}

        mutations = {
            "resolved environment": lambda container: container["Config"]["Env"].append("ENV_FILE_SECRET=changed"),
            "mount source": lambda container: container["Mounts"][0].update(Source="/unexpected/data"),
            "published port": add_published_port,
            "network": lambda container: container["NetworkSettings"].update(Networks={"unexpected_default": {}}),
            "command": lambda container: container["Config"]["Cmd"].append("changed.js"),
            "entrypoint": lambda container: container["Config"]["Entrypoint"].append("changed"),
            "user": lambda container: container["Config"].update(User="unexpected"),
            "working directory": lambda container: container["Config"].update(WorkingDir="/unexpected"),
            "init": lambda container: container["HostConfig"].update(Init=False),
            "restart policy": lambda container: container["HostConfig"]["RestartPolicy"].update(Name="always"),
            "health check": lambda container: container["Config"]["Healthcheck"].update(Retries=4),
            "user label": lambda container: container["Config"]["Labels"].update({"example.user-label": "changed"}),
        }
        for field, mutate in mutations.items():
            with self.subTest(field=field):
                model, image, container, runtime_config = self._runtime_projection_fixture()
                mutate(container)
                with self.assertRaises(DEPLOY.DeployError) as raised:
                    DEPLOY._assert_service_runtime_projection(
                        self.config["app_service"], model, container, image, runtime_config
                    )
                self.assertNotIn("secret-from-root-env-file", str(raised.exception))

        model, image, redis, runtime_config = self._runtime_projection_fixture(self.config["redis_service"])
        DEPLOY._assert_service_runtime_projection(
            self.config["redis_service"], model, redis, image, runtime_config
        )
        redis["State"]["Health"]["Status"] = "unhealthy"
        with self.assertRaises(DEPLOY.DeployError):
            DEPLOY._assert_service_runtime_projection(
                self.config["redis_service"], model, redis, image, runtime_config
            )

    def test_candidate_model_must_differ_only_by_app_image(self):
        model, _image, _container, _runtime_config = self._runtime_projection_fixture()
        candidate = copy.deepcopy(model)
        candidate["services"][self.config["app_service"]]["image"] = "ghcr.io/example/omniroute@sha256:" + ("d" * 64)
        DEPLOY._assert_candidate_image_only(
            model,
            candidate,
            self.config["app_service"],
            candidate["services"][self.config["app_service"]]["image"],
        )

        candidate["services"][self.config["app_service"]]["environment"]["DATA_DIR"] = "/tmp/changed"
        with self.assertRaises(DEPLOY.DeployError):
            DEPLOY._assert_candidate_image_only(
                model,
                candidate,
                self.config["app_service"],
                candidate["services"][self.config["app_service"]]["image"],
            )

    def test_runtime_projection_fails_closed_on_unsupported_compose_shapes(self):
        def published_port(service):
            service["ports"].append({
                "target": 20129,
                "published": "37707",
                "host_ip": "127.0.0.1",
                "mode": "ingress",
            })

        def unsupported_port_mode(service):
            published_port(service)
            service["ports"][-1]["mode"] = "host"

        def missing_port_mode(service):
            published_port(service)
            service["ports"][-1].pop("mode")

        for description, mutate in (
            ("named volume", lambda service: service["volumes"][0].update(type="volume")),
            ("network alias", lambda service: service["networks"]["internal"].update(aliases=["extra"])),
            ("published port", published_port),
            ("unsupported port mode", unsupported_port_mode),
            ("missing port mode", missing_port_mode),
        ):
            with self.subTest(description=description):
                model, image, container, runtime_config = self._runtime_projection_fixture()
                mutate(model["services"][self.config["app_service"]])
                with self.assertRaises(DEPLOY.DeployError):
                    DEPLOY._assert_service_runtime_projection(
                        self.config["app_service"], model, container, image, runtime_config
                    )

    def test_baseline_dry_run_accepts_only_app_running_noop(self):
        DEPLOY._assert_app_dry_run_noop(b"DRY-RUN MODE - Container omniroute Running\n", "omniroute")

        for output in (
            b"",
            b"Container omniroute Running\n",
            b"Container omniroute Recreate\n",
            b"Container omniroute Starting\n",
            b"DRY-RUN MODE - Container omniroute Recreate\n",
            b"Container redis Running\n",
            b"Container omniroute Running\nContainer redis Running\n",
            b"DRY-RUN MODE - Container omniroute Running\nUnknown action\n",
        ):
            with self.subTest(output=output):
                with self.assertRaises(DEPLOY.DeployError):
                    DEPLOY._assert_app_dry_run_noop(output, "omniroute")

    def test_baseline_dry_run_accepts_compose_column_alignment(self):
        DEPLOY._assert_app_dry_run_noop(
            b" DRY-RUN MODE -  Container omniroute  Running\n", "omniroute"
        )

    def test_baseline_dry_run_targets_only_app_without_deps_build_or_pull(self):
        backend = DEPLOY.DockerBackend(self.config, DEPLOY.parse_request(VALID_RECORD), None)
        backend._compose_command = lambda _config: ["/usr/bin/docker", "compose", "--project-name", "fixture"]
        output = ("DRY-RUN MODE - Container " + self.config["app_container"] + " Running\n").encode("ascii")
        with patch.object(DEPLOY, "_run_command", return_value=output) as run_command:
            backend._validate_baseline_app_noop(self.config)

        self.assertEqual(
            run_command.call_args[0][0],
            [
                "/usr/bin/docker", "compose", "--dry-run", "--progress", "plain", "--project-name", "fixture",
                "up", "-d", "--no-deps", "--no-build", "--pull", "never", "omniroute",
            ],
        )
        self.assertTrue(run_command.call_args[1]["merge_stderr"])

    def test_command_runner_merges_stderr_only_when_requested(self):
        marker = b"DRY-RUN MODE - Container omniroute Running\n"
        script = "import sys; sys.stderr.write(%r); sys.stderr.flush()" % marker.decode("ascii")
        command = [sys.executable, "-c", script]

        self.assertEqual(DEPLOY._run_command(command, 10, "COMMAND_FAILED"), b"")
        self.assertEqual(
            DEPLOY._run_command(command, 10, "COMMAND_FAILED", merge_stderr=True),
            marker,
        )

    def test_restore_uses_fresh_temporary_file_after_interrupted_restore(self):
        with tempfile.TemporaryDirectory() as root:
            database_dir = os.path.join(root, "data")
            backup_root = os.path.join(root, "backups")
            os.mkdir(database_dir)
            os.mkdir(backup_root)
            database_path = os.path.join(database_dir, "storage.sqlite")
            backup_path = os.path.join(backup_root, "protected.sqlite")
            stale_path = database_path + ".restore-" + KEY
            with open(database_path, "wb") as database:
                database.write(b"candidate database")
            with open(backup_path, "wb") as backup:
                backup.write(b"protected online backup")
            with open(stale_path, "wb") as stale:
                stale.write(b"partial interrupted restore")

            backend = DEPLOY.DockerBackend(
                {"database_path": database_path, "backup_root": backup_root},
                DEPLOY.parse_request(VALID_RECORD),
                None,
            )
            backend.restore_database(
                backup_path,
                backend.config,
                {"db_uid": os.getuid(), "db_gid": os.getgid(), "db_mode": 0o600},
            )

            with open(database_path, "rb") as restored:
                self.assertEqual(restored.read(), b"protected online backup")
            with open(stale_path, "rb") as stale:
                self.assertEqual(stale.read(), b"partial interrupted restore")


class DatabaseValidationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="omniroute-db-validation-test-")
        self.addCleanup(temporary.cleanup)
        self.root = temporary.name
        self.database_path = os.path.join(self.root, "storage.sqlite")
        database = sqlite3.connect(self.database_path)
        try:
            self.assertEqual(database.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
            database.execute("CREATE TABLE validation_probe (value INTEGER NOT NULL)")
            database.execute("INSERT INTO validation_probe VALUES (1)")
            database.commit()
        finally:
            database.close()
        self.backend = DEPLOY.DockerBackend.__new__(DEPLOY.DockerBackend)
        self.config = {
            "data_dir": self.root,
            "migration_catalog_path": os.path.join(os.path.dirname(MODULE_PATH), "migration-catalog.cjs"),
        }

    def test_standalone_wal_snapshot_validation_uses_owner_and_cleans_sidecars(self):
        database_metadata = os.lstat(self.database_path)
        database_sha = DEPLOY._file_sha256(self.database_path)
        report = b'{"integrityOk":true,"foreignKeyViolationCount":0,"migrationCoverageOk":false}\n'

        def native_check(command, _timeout, _error_code, input_data=None):
            mount = command[command.index("--mount") + 1]
            self.assertEqual(
                mount,
                "type=bind,src=%s,dst=/tmp/omniroute-backup" % self.root,
            )
            self.assertEqual(
                command[command.index("--user") + 1],
                "%s:%s" % (database_metadata.st_uid, database_metadata.st_gid),
            )
            self.assertIn(b"readonly: true", input_data)
            database = sqlite3.connect("file:%s?mode=ro" % self.database_path, uri=True)
            try:
                integrity = database.execute("PRAGMA integrity_check").fetchone()[0]
                violations = database.execute("PRAGMA foreign_key_check").fetchall()
                self.assertEqual(integrity, "ok")
                self.assertEqual(violations, [])
                self.assertTrue(os.path.lexists(self.database_path + "-wal"))
                self.assertTrue(os.path.lexists(self.database_path + "-shm"))
            finally:
                database.close()
            return report

        with patch.object(DEPLOY, "_run_command", side_effect=native_check):
            result = self.backend._database_report(
                self.database_path,
                "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
                self.config,
                live=False,
            )

        self.assertTrue(result["integrityOk"])
        self.assertEqual(DEPLOY._file_sha256(self.database_path), database_sha)
        current = os.lstat(self.database_path)
        self.assertEqual(
            (current.st_uid, current.st_gid, current.st_mode),
            (database_metadata.st_uid, database_metadata.st_gid, database_metadata.st_mode),
        )
        self.assertFalse(os.path.lexists(self.database_path + "-wal"))
        self.assertFalse(os.path.lexists(self.database_path + "-shm"))

    def test_standalone_validation_preserves_preexisting_sidecars(self):
        wal_path = self.database_path + "-wal"
        shm_path = self.database_path + "-shm"
        with open(wal_path, "wb") as sidecar:
            sidecar.write(b"existing-wal")
        os.symlink("missing-shm-target", shm_path)

        report = b'{"integrityOk":true,"foreignKeyViolationCount":0,"migrationCoverageOk":false}\n'
        with patch.object(DEPLOY, "_run_command", return_value=report) as run_command:
            with self.assertRaises(DEPLOY.DeployError) as raised:
                self.backend._database_report(
                    self.database_path,
                    "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
                    self.config,
                    live=False,
                )

        self.assertEqual(raised.exception.code, "DATABASE_SIDECAR_PRESENT")
        with open(wal_path, "rb") as sidecar:
            self.assertEqual(sidecar.read(), b"existing-wal")
        self.assertTrue(os.path.islink(shm_path))
        run_command.assert_not_called()

    def test_snapshot_validation_never_follows_new_sidecar_symlinks(self):
        target_path = os.path.join(self.root, "sentinel")
        database_sha = DEPLOY._file_sha256(self.database_path)
        with open(target_path, "wb") as target:
            target.write(b"untouched")
        sidecar_path = self.database_path + "-wal"
        report = b'{"integrityOk":true,"foreignKeyViolationCount":0,"migrationCoverageOk":false}\n'

        def native_check(*_args, **_kwargs):
            os.symlink(target_path, sidecar_path)
            return report

        with patch.object(DEPLOY, "_run_command", side_effect=native_check):
            with self.assertRaises(DEPLOY.DeployError) as raised:
                self.backend._database_report(
                    self.database_path,
                    "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
                    self.config,
                    live=False,
                )

        self.assertEqual(raised.exception.code, "DATABASE_SIDECAR_CLEANUP_FAILED")
        self.assertTrue(os.path.islink(sidecar_path))
        self.assertEqual(DEPLOY._file_sha256(self.database_path), database_sha)
        with open(target_path, "rb") as target:
            self.assertEqual(target.read(), b"untouched")

    def test_live_validation_keeps_full_data_directory_readonly(self):
        for suffix in ("-wal", "-shm"):
            with open(self.database_path + suffix, "wb") as sidecar:
                sidecar.write(b"live-%s" % suffix.encode("ascii"))
        report = b'{"integrityOk":true,"foreignKeyViolationCount":0,"migrationCoverageOk":true}\n'
        original_lstat = os.lstat

        def lstat_with_database_owner(path):
            metadata = original_lstat(path)
            if path == self.database_path:
                return SimpleNamespace(st_mode=metadata.st_mode, st_uid=1000, st_gid=1000)
            return metadata

        with patch.object(DEPLOY.os, "lstat", side_effect=lstat_with_database_owner):
            with patch.object(DEPLOY, "_run_command", return_value=report) as run_command:
                self.backend._database_report(
                    self.database_path,
                    "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
                    self.config,
                    live=True,
                )

        command = run_command.call_args[0][0]
        mount = command[command.index("--mount") + 1]
        self.assertEqual(
            mount,
            "type=bind,src=%s,dst=/tmp/omniroute-data,readonly" % self.root,
        )
        self.assertEqual(command[command.index("--user") + 1], "1000:1000")
        for suffix in ("-wal", "-shm"):
            with open(self.database_path + suffix, "rb") as sidecar:
                self.assertEqual(sidecar.read(), b"live-%s" % suffix.encode("ascii"))

    def test_live_validation_rejects_symlink_database(self):
        target = os.path.join(self.root, "target.sqlite")
        os.rename(self.database_path, target)
        os.symlink(target, self.database_path)

        with patch.object(DEPLOY, "_run_command") as run_command:
            with self.assertRaises(DEPLOY.DeployError) as raised:
                self.backend._database_report(
                    self.database_path,
                    "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
                    self.config,
                    live=True,
                )

        self.assertEqual(raised.exception.code, "DATABASE_PATH_INVALID")
        run_command.assert_not_called()

    def test_live_validation_rejects_unknown_database_owner(self):
        original_lstat = os.lstat

        def lstat_without_database_owner(path):
            metadata = original_lstat(path)
            if path == self.database_path:
                return SimpleNamespace(st_mode=metadata.st_mode, st_uid=None, st_gid=1000)
            return metadata

        with patch.object(DEPLOY.os, "lstat", side_effect=lstat_without_database_owner):
            with patch.object(DEPLOY, "_run_command") as run_command:
                with self.assertRaises(DEPLOY.DeployError) as raised:
                    self.backend._database_report(
                        self.database_path,
                        "ghcr.io/etcetera-agency/omniroute@" + DIGEST,
                        self.config,
                        live=True,
                    )

        self.assertEqual(raised.exception.code, "DATABASE_PATH_INVALID")
        run_command.assert_not_called()


class ContainerRouteProbeTests(unittest.TestCase):
    def test_private_probe_uses_node_inside_app_at_fixed_loopback_routes(self):
        backend = DEPLOY.DockerBackend.__new__(DEPLOY.DockerBackend)
        output = b"UI_200\nAPI_AUTH_002\n"

        with patch.object(DEPLOY, "_run_command", return_value=output) as run_command:
            backend._probe_container_routes("omniroute", 7)

        argv, timeout, error_code = run_command.call_args[0][:3]
        self.assertEqual(argv[:5], [DEPLOY.DOCKER, "exec", "omniroute", "node", "-e"])
        self.assertEqual(timeout, 7)
        self.assertEqual(error_code, "LOCAL_ROUTE_PROBE_FAILED")
        script = argv[5]
        self.assertIn("127.0.0.1", script)
        self.assertIn("20128", script)
        self.assertIn("/api/v1/models", script)
        self.assertIn("MAX_REDIRECTS", script)
        self.assertNotIn("30129", script)
        self.assertEqual(len(argv), 6)

    def test_node_probe_follows_local_ui_redirect_and_rejects_external_redirect(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node.js is unavailable for the redirect probe check")

        class Handler(http.server.BaseHTTPRequestHandler):
            redirect_location = "/login"

            def do_GET(self):
                if self.path == "/":
                    self.send_response(302)
                    self.send_header("Location", self.redirect_location)
                    self.end_headers()
                    return
                if self.path == "/login":
                    self._respond(200, b"dashboard")
                    return
                if self.path == "/api/v1/models":
                    self._respond(401, b'{"error":{"code":"AUTH_002"}}', "application/json")
                    return
                self._respond(404, b"not found")

            def _respond(self, status, body, content_type="text/plain"):
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _format, *_args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.daemon = True
        thread.start()
        script = DEPLOY.LOCAL_ROUTE_PROBE_SCRIPT.replace("20128", str(server.server_port))
        try:
            result = subprocess.run(
                [node, "-e", script],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, DEPLOY.LOCAL_ROUTE_PROBE_SUCCESS)

            Handler.redirect_location = "http://example.invalid/login"
            external = subprocess.run(
                [node, "-e", script],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
            )
            self.assertNotEqual(external.returncode, 0)
            self.assertEqual(external.stdout, b"LOCAL_PROBE_ERROR\n")
            self.assertEqual(external.stderr, b"")
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_private_probe_rejects_any_noncanonical_output(self):
        backend = DEPLOY.DockerBackend.__new__(DEPLOY.DockerBackend)

        with patch.object(DEPLOY, "_run_command", return_value=b"UI_200\nAPI_AUTH_002\nprivate body"):
            with self.assertRaises(DEPLOY.DeployError) as error:
                backend._probe_container_routes("omniroute", 7)

        self.assertEqual(error.exception.code, "LOCAL_ROUTE_PROBE_INVALID")

    def test_public_404_fails_candidate_acceptance_and_rolls_back(self):
        class RoutingBackend(FakeBackend):
            def _probe_container_routes(self, container_name, timeout):
                self.events.append(("local_route_probe", container_name))

            def accept_candidate(self, image_ref, config, prior, deadline):
                self.events.append(("accept_candidate", image_ref))
                DEPLOY.DockerBackend._wait_routes(
                    self, config, DEPLOY.time.monotonic() + 0.002, include_public=True
                )

            def verify_prior_service(self, image_ref, config, deadline):
                FakeBackend.verify_prior_service(self, image_ref, config, deadline)

        temporary = tempfile.TemporaryDirectory(prefix="omniroute-public-probe-test-")
        try:
            database_path = os.path.join(temporary.name, "storage.sqlite")
            with open(database_path, "wb") as handle:
                handle.write(b"fixture-production-format-db")
            backend = RoutingBackend(database_path)
            store = FakeStore(temporary.name)
            request = DEPLOY.parse_request(VALID_RECORD)
            config = {
                "profile": "fixture",
                "state_root": temporary.name,
                "backup_root": temporary.name,
                "database_path": database_path,
                "transaction_budget_seconds": 300,
                "app_container": "omniroute-cd-fixture-app",
                "public_dashboard_url": "http://127.0.0.1:30128/dashboard/radar",
            }

            with patch.object(DEPLOY, "_http_response", return_value=(404, b"not found")) as public_response:
                result = DEPLOY.run_transaction(request, config, backend, store)

            self.assertEqual(result["status"], "FAILED")
            self.assertEqual(result["code"], "PUBLIC_DASHBOARD_HTTP_INVALID")
            self.assertTrue(result["rollback_succeeded"])
            self.assertIn(("local_route_probe", "omniroute-cd-fixture-app"), backend.events)
            self.assertIn(("start_prior", backend.prior_image), backend.events)
            self.assertEqual(public_response.call_args[0][0], config["public_dashboard_url"])
        finally:
            temporary.cleanup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
