#!/usr/bin/python3
"""Restricted, durable production deployment helper for OmniRoute."""

import base64
import contextlib
import copy
import errno
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import namedtuple


IMAGE_REPOSITORY = "ghcr.io/etcetera-agency/omniroute"
SOURCE_REPOSITORY = "https://github.com/Etcetera-Agency/OmniRoute"
OFFICIAL_BASE_DIGEST = "sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96"
PUBLIC_MAIN_API = "https://api.github.com/repos/etcetera-agency/omniroute/git/ref/heads/main"
PRODUCTION_CONFIG = "/etc/omniroute-deploy/production.json"
PRODUCTION_COMPOSE_ROOT = "/etc/omniroute-deploy/compose"
PRODUCTION_COMPOSE_FILES = [
    os.path.join(PRODUCTION_COMPOSE_ROOT, "base.yml"),
    os.path.join(PRODUCTION_COMPOSE_ROOT, "candidate.yml"),
    os.path.join(PRODUCTION_COMPOSE_ROOT, "browser.yml"),
    os.path.join(PRODUCTION_COMPOSE_ROOT, "image.yml"),
]
PRODUCTION_PROJECT_DIR = "/opt/apps/omniroute"
PRODUCTION_DATABASE = "/opt/apps/omniroute/data/storage.sqlite"
PRODUCTION_DIAGNOSTICS = "/opt/apps/omniroute-deploy-diagnostics"
PRODUCTION_LOCK = "/run/lock/omniroute-deploy.lock"
TRANSACTION_PATH = "/usr/local/libexec/omniroute-deploy-transaction"
LAUNCHER_PATH = "/usr/local/sbin/omniroute-deploy"
CATALOG_PATH = "/usr/local/libexec/omniroute-migration-catalog.cjs"
SUDO_PATH = "/usr/bin/sudo"
SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
DOCKER = "/usr/bin/docker"
SQLITE3 = "/usr/bin/sqlite3"
SQLITE_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")
MAX_REQUEST_BYTES = 160
MAX_STATUS_BYTES = 256
PULL_TIMEOUT_SECONDS = 1800
COMPOSE_START_TIMEOUT_SECONDS = 120
SQLITE_OPERATION_TIMEOUT_SECONDS = 120
ROUTE_PROBE_TIMEOUT_SECONDS = 60
LOCAL_ROUTE_PROBE_TIMEOUT_SECONDS = 30
API_TIMEOUT_SECONDS = 10
RUN_ID_PATTERN = re.compile(r"^[1-9][0-9]{0,19}$")
ATTEMPT_PATTERN = re.compile(r"^[1-9][0-9]{0,9}$")
KEY_PATTERN = re.compile(r"^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$")
DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SAFE_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")

# AICODE-NOTE: Fixed in-container probes avoid treating the host's gateway port as the app listener.
LOCAL_ROUTE_PROBE_SCRIPT = r'''const http = require('http');
const URL = require('url').URL;
const BASE = 'http://127.0.0.1:20128';
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 65536;
function get(path, captureBody, redirects, base) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, base || BASE + '/');
    if (target.origin !== BASE || target.username || target.password || target.hash) {
      reject(new Error());
      return;
    }
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port: 20128,
        path: target.pathname + target.search,
        method: 'GET'
      },
      response => {
        const status = response.statusCode;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].indexOf(status) !== -1 && location) {
          response.resume();
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error());
            return;
          }
          return get(location, captureBody, redirects + 1, target).then(resolve, reject);
        }
        const chunks = [];
        let bodyBytes = 0;
        response.on('data', chunk => {
          if (!captureBody) return;
          bodyBytes += chunk.length;
          if (bodyBytes > MAX_BODY_BYTES) {
            response.destroy(new Error());
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({
          status: status,
          body: Buffer.concat(chunks).toString('utf8')
        }));
        response.on('error', reject);
      }
    );
    request.setTimeout(5000, () => request.destroy(new Error()));
    request.on('error', reject);
  });
}
Promise.all([get('/', false, 0), get('/api/v1/models', true, 0)]).then(results => {
  let code = null;
  try { code = JSON.parse(results[1].body).error.code; } catch (_error) {}
  const uiOk = results[0].status === 200;
  const apiOk = results[1].status === 401 && code === 'AUTH_002';
  process.stdout.write([
    uiOk ? 'UI_200' : 'UI_BAD',
    apiOk ? 'API_AUTH_002' : 'API_BAD'
  ].join('\n') + '\n');
  if (!uiOk || !apiOk) process.exitCode = 2;
}).catch(() => {
  process.stdout.write('LOCAL_PROBE_ERROR\n');
  process.exitCode = 1;
});'''
LOCAL_ROUTE_PROBE_SUCCESS = b"UI_200\nAPI_AUTH_002\n"

RequestTuple = namedtuple("RequestTuple", "digest source_sha run_id attempt")


class InvalidRequest(Exception):
    pass


class RequestConflict(Exception):
    pass


class ConfigurationError(Exception):
    pass


class DeployError(Exception):
    def __init__(self, code):
        self.code = code if SAFE_CODE_PATTERN.match(code or "") else "INTERNAL_ERROR"
        Exception.__init__(self, self.code)


class TransactionInterrupted(DeployError):
    def __init__(self):
        DeployError.__init__(self, "PROCESS_INTERRUPTED")


class Request(RequestTuple):
    __slots__ = ()

    @property
    def key(self):
        return self.run_id + "-" + self.attempt

    @property
    def image_ref(self):
        return IMAGE_REPOSITORY + "@" + self.digest

    def as_dict(self):
        return {
            "digest": self.digest,
            "source_sha": self.source_sha,
            "run_id": self.run_id,
            "attempt": self.attempt,
        }


def parse_request(raw):
    """Validate the exact one-line SSH record without shell or int parsing."""
    if not isinstance(raw, bytes) or len(raw) > MAX_REQUEST_BYTES:
        raise InvalidRequest("invalid request length")
    if not raw.endswith(b"\n") or raw.count(b"\n") != 1 or b"\r" in raw or b"\x00" in raw:
        raise InvalidRequest("invalid request framing")
    try:
        fields = raw[:-1].decode("ascii").split(" ")
    except UnicodeDecodeError:
        raise InvalidRequest("invalid request encoding")
    if len(fields) != 4 or any(not field for field in fields):
        raise InvalidRequest("invalid request fields")
    digest, source_sha, run_id, attempt = fields
    if not DIGEST_PATTERN.match(digest):
        raise InvalidRequest("invalid digest")
    if not SHA_PATTERN.match(source_sha):
        raise InvalidRequest("invalid source SHA")
    if not RUN_ID_PATTERN.match(run_id) or not ATTEMPT_PATTERN.match(attempt):
        raise InvalidRequest("invalid run identity")
    return Request(digest, source_sha, run_id, attempt)


def request_from_dict(value):
    if not isinstance(value, dict):
        raise InvalidRequest("invalid stored request")
    fields = (value.get("digest"), value.get("source_sha"), value.get("run_id"), value.get("attempt"))
    if not all(isinstance(field, str) for field in fields):
        raise InvalidRequest("invalid stored request")
    return parse_request(("%s %s %s %s\n" % fields).encode("ascii"))


def _write_stream(stream, data):
    try:
        stream.write(data)
        stream.flush()
    except (AttributeError, TypeError):
        stream.write(data.decode("ascii"))
        stream.flush()


def _sudo_execute(argv, payload):
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        stdout, stderr = process.communicate(payload)
    except BaseException:
        try:
            process.kill()
        except OSError:
            pass
        process.communicate()
        raise
    return process.returncode, stdout, stderr


def _parse_status_output(payload, request, exit_code):
    if not isinstance(payload, bytes) or len(payload) > MAX_STATUS_BYTES:
        return None
    if not payload.endswith(b"\n") or payload.count(b"\n") != 1:
        return None
    try:
        line = payload[:-1].decode("ascii")
    except UnicodeDecodeError:
        return None
    fields = line.split(" ")
    if len(fields) == 2 and fields[0] in ("SUCCEEDED", "SKIPPED_STALE"):
        if fields[1] == request.key and exit_code == 0:
            return line + "\n"
        return None
    if len(fields) == 3 and fields[0] == "FAILED":
        if fields[1] == request.key and SAFE_CODE_PATTERN.match(fields[2]) and exit_code != 0:
            return line + "\n"
    return None


def run_ssh_gate(original_command, payload, sudo_executor=None, stdout=None, stderr=None):
    """Validate the forced-command boundary, invoke only fixed sudo, filter output."""
    stdout = sys.stdout if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        if original_command != "deploy-main":
            raise InvalidRequest("wrong command")
        request = parse_request(payload)
    except InvalidRequest:
        _write_stream(stderr, b"request rejected\n")
        return 64

    executor = sudo_executor or _sudo_execute
    argv = [SUDO_PATH, "-n", LAUNCHER_PATH]
    try:
        result = executor(argv, payload)
    except Exception:
        _write_stream(stderr, b"deployment launcher unavailable\n")
        return 1
    exit_code, root_stdout, _root_stderr = result
    safe_status = _parse_status_output(root_stdout, request, exit_code)
    if safe_status is None:
        _write_stream(stdout, ("FAILED %s STATUS_INVALID\n" % request.key).encode("ascii"))
        return 1
    _write_stream(stdout, safe_status.encode("ascii"))
    return exit_code


def _is_inside(path, root):
    path = os.path.realpath(path)
    root = os.path.realpath(root)
    return os.path.commonpath([path, root]) == root


def validate_fixture_config(config):
    if not isinstance(config, dict) or config.get("profile") != "fixture":
        raise ConfigurationError("fixture profile required")
    root = config.get("fixture_root")
    if not isinstance(root, str) or not os.path.isabs(root) or os.path.normpath(root) != root or not re.match(r"^/[A-Za-z0-9._/-]+$", root):
        raise ConfigurationError("invalid fixture root")
    if not re.match(r"^omniroute-cd-fixture-[a-z0-9-]{1,48}$", config.get("compose_project_name", "")):
        raise ConfigurationError("invalid fixture project name")
    if config.get("app_service") != "omniroute" or config.get("redis_service") != "redis":
        raise ConfigurationError("invalid fixture service names")
    paths = []
    compose_files = config.get("compose_files")
    if not isinstance(compose_files, list) or len(compose_files) != 4:
        raise ConfigurationError("fixture requires four Compose files")
    paths.extend(compose_files)
    for field in ("project_dir", "data_dir", "database_path", "image_override_path", "state_root", "backup_root", "candidate_root", "lock_path"):
        paths.append(config.get(field))
    for path in paths:
        if not isinstance(path, str) or not os.path.isabs(path) or not _is_inside(path, root):
            raise ConfigurationError("fixture paths must stay under fixture root")
    if compose_files[-1] != config.get("image_override_path"):
        raise ConfigurationError("fixture image override must be final Compose input")
    if config.get("database_path") != os.path.join(config.get("data_dir"), "storage.sqlite"):
        raise ConfigurationError("fixture DB path must be storage.sqlite under fixture data")
    if config.get("state_root") != os.path.join(root, "status"):
        raise ConfigurationError("fixture status path invalid")
    if config.get("backup_root") != os.path.join(root, "transactions"):
        raise ConfigurationError("fixture backup path invalid")
    if config.get("candidate_root") != config.get("backup_root"):
        raise ConfigurationError("fixture candidate path invalid")
    if config.get("migration_catalog_path") != CATALOG_PATH:
        raise ConfigurationError("fixture migration catalog path invalid")
    for field in ("app_container", "redis_container"):
        name = config.get(field)
        if not isinstance(name, str) or not re.match(r"^[a-z][a-z0-9_-]{0,62}$", name):
            raise ConfigurationError("invalid fixture container name")
    if config.get("app_container") == "omniroute" or config.get("redis_container") == "omniroute-redis":
        raise ConfigurationError("fixture container names must be unique")
    if "published_port_hosts" in config:
        raise ConfigurationError("fixture published ports are forbidden")
    if "dashboard_url" in config or "api_url" in config:
        raise ConfigurationError("private route probes are fixed")
    _validate_fixture_public_dashboard_url(config.get("public_dashboard_url"))
    expected_sha = config.get("fixture_expected_source_sha")
    if expected_sha is not None and (not isinstance(expected_sha, str) or not SHA_PATTERN.match(expected_sha)):
        raise ConfigurationError("invalid fixture source override")
    return config


def require_root_mode_0600(path, stat_result=None, current_uid=None):
    if current_uid is None:
        current_uid = os.geteuid()
    try:
        metadata = stat_result if stat_result is not None else os.lstat(path)
    except OSError:
        raise ConfigurationError("configuration unavailable")
    if current_uid != 0 or metadata.st_uid != 0 or stat.S_ISLNK(metadata.st_mode):
        raise ConfigurationError("configuration ownership invalid")
    if stat.S_IMODE(metadata.st_mode) != 0o600 or not stat.S_ISREG(metadata.st_mode):
        raise ConfigurationError("configuration mode invalid")
    return True


def load_config(path, profile, current_uid=None):
    if profile == "production" and path != PRODUCTION_CONFIG:
        raise ConfigurationError("production config path is fixed")
    require_root_mode_0600(path, current_uid=current_uid)
    try:
        with open(path, "r") as handle:
            config = json.load(handle)
    except (IOError, ValueError):
        raise ConfigurationError("configuration unreadable")
    if not isinstance(config, dict) or config.get("profile") != profile:
        raise ConfigurationError("configuration profile mismatch")
    if profile == "fixture":
        validate_fixture_config(config)
    else:
        _validate_production_config(config)
    return config


def _validate_production_config(config):
    if config.get("profile") != "production":
        raise ConfigurationError("production profile required")
    exact_values = {
        "project_dir": PRODUCTION_PROJECT_DIR,
        "data_dir": "/opt/apps/omniroute/data",
        "database_path": PRODUCTION_DATABASE,
        "state_root": os.path.join(PRODUCTION_DIAGNOSTICS, "status"),
        "backup_root": os.path.join(PRODUCTION_DIAGNOSTICS, "transactions"),
        "candidate_root": os.path.join(PRODUCTION_DIAGNOSTICS, "transactions"),
        "lock_path": PRODUCTION_LOCK,
        "app_service": "omniroute",
        "redis_service": "omniroute-redis",
        "app_container": "omniroute",
        "redis_container": "omniroute-redis",
        "compose_project_name": "omniroute",
        "migration_catalog_path": CATALOG_PATH,
    }
    for field, expected in exact_values.items():
        if config.get(field) != expected:
            raise ConfigurationError("production config value invalid")
    compose_files = config.get("compose_files")
    if compose_files != PRODUCTION_COMPOSE_FILES:
        raise ConfigurationError("production requires four Compose files")
    if config.get("image_override_path") != compose_files[-1]:
        raise ConfigurationError("image override must be final Compose input")
    if "dashboard_url" in config or "api_url" in config:
        raise ConfigurationError("private route probes are fixed")
    _validate_http_url(config.get("public_dashboard_url"), loopback=False, require_https=True)
    if "fixture_expected_source_sha" in config:
        raise ConfigurationError("fixture override forbidden in production")
    return config


def _validate_http_url(value, loopback, require_https=False):
    if not isinstance(value, str):
        raise ConfigurationError("health probe URL missing")
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except (ValueError, TypeError):
        raise ConfigurationError("health probe URL invalid")
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise ConfigurationError("health probe URL invalid")
    if loopback and (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or port is None):
        raise ConfigurationError("health probe URL must use loopback")
    if require_https and parsed.scheme != "https":
        raise ConfigurationError("public health probe must use HTTPS")


def _validate_fixture_public_dashboard_url(value):
    _validate_http_url(value, loopback=True)
    parsed = urllib.parse.urlsplit(value)
    if parsed.path != "/dashboard/radar" or parsed.netloc != "127.0.0.1:%d" % parsed.port:
        raise ConfigurationError("fixture public probe URL invalid")


def _safe_key(key):
    if not isinstance(key, str) or not KEY_PATTERN.match(key):
        raise InvalidRequest("invalid transaction key")
    return key


def _terminal(state):
    return isinstance(state, dict) and state.get("status") in ("SUCCEEDED", "SKIPPED_STALE", "FAILED")


def _result_line(state, key):
    status = state.get("status")
    if status in ("SUCCEEDED", "SKIPPED_STALE"):
        return "%s %s\n" % (status, key)
    if status == "FAILED" and SAFE_CODE_PATTERN.match(state.get("code", "")):
        return "FAILED %s %s\n" % (key, state["code"])
    return "FAILED %s INTERNAL_ERROR\n" % key


class StateStore(object):
    def __init__(self, state_root, backup_root):
        self.state_root = state_root
        self.backup_root = backup_root
        _ensure_private_directory(state_root, 0o700)
        _ensure_private_directory(backup_root, 0o700)

    def _record_path(self, key):
        return os.path.join(self.state_root, _safe_key(key) + ".json")

    def _key_lock(self, key):
        return os.path.join(self.state_root, _safe_key(key) + ".lock")

    @contextlib.contextmanager
    def _launch_locked(self, key):
        path = os.path.join(self.state_root, _safe_key(key) + ".launch.lock")
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    @contextlib.contextmanager
    def _locked(self, key):
        descriptor = os.open(self._key_lock(key), os.O_CREAT | os.O_RDWR, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def get(self, key):
        path = self._record_path(key)
        try:
            metadata = os.lstat(path)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                raise DeployError("STATE_INVALID")
            if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600:
                raise DeployError("STATE_PERMISSIONS_INVALID")
            if metadata.st_size > 16384:
                raise DeployError("STATE_INVALID")
            with open(path, "r") as handle:
                value = json.load(handle)
        except IOError as error:
            if error.errno == errno.ENOENT:
                return None
            raise DeployError("STATE_READ_FAILED")
        except ValueError:
            raise DeployError("STATE_INVALID")
        if not isinstance(value, dict) or value.get("key") != key:
            raise DeployError("STATE_INVALID")
        return value

    def create(self, request):
        with self._locked(request.key):
            existing = self.get(request.key)
            if existing is not None:
                if existing.get("request") != request.as_dict():
                    raise RequestConflict("REQUEST_CONFLICT")
                return existing
            value = {
                "key": request.key,
                "request": request.as_dict(),
                "status": "RUNNING",
                "phase": "accepted",
                "candidate_may_mutate": False,
                "created_at": int(time.time()),
                "updated_at": int(time.time()),
            }
            self._write(value)
            return value

    def update(self, key, **changes):
        with self._locked(key):
            value = self.get(key)
            if value is None:
                raise DeployError("STATE_MISSING")
            value.update(changes)
            value["updated_at"] = int(time.time())
            self._write(value)
            return value

    def backup_path(self, key):
        directory = os.path.join(self.backup_root, _safe_key(key))
        _ensure_private_directory(directory, 0o700)
        return os.path.join(directory, "pre-deploy.sqlite")

    def diagnostic_path(self, key):
        directory = os.path.join(self.backup_root, _safe_key(key))
        _ensure_private_directory(directory, 0o700)
        return os.path.join(directory, "failed-candidate.sqlite")

    def candidate_override_path(self, key):
        directory = os.path.join(self.backup_root, _safe_key(key))
        _ensure_private_directory(directory, 0o700)
        return os.path.join(directory, "candidate-image.yml")

    def _write(self, value):
        key = _safe_key(value.get("key"))
        path = self._record_path(key)
        _write_atomic(path, (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"), 0o600)


def _ensure_private_directory(path, mode):
    if not os.path.exists(path):
        os.makedirs(path, mode)
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise DeployError("PATH_INVALID")
    if metadata.st_uid != 0:
        raise DeployError("PATH_OWNER_INVALID")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        os.chmod(path, mode)
    os.chown(path, 0, 0)
    os.chmod(path, mode)


def _write_atomic(path, data, mode):
    parent = os.path.dirname(path)
    _ensure_private_directory(parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix="." + os.path.basename(path) + ".", dir=parent)
    try:
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, 0)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        dir_descriptor = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(dir_descriptor)
        finally:
            os.close(dir_descriptor)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _transaction_requires_recovery(state):
    return isinstance(state, dict) and (
        state.get("app_stop_attempted") is True or state.get("candidate_may_mutate") is True
    )


def submit_request(request, config, store, unit_manager):
    """Create or reattach to one durable transaction; never cancel its unit."""
    with store._launch_locked(request.key):
        state = store.get(request.key)
        if state is not None and state.get("request") != request.as_dict():
            raise RequestConflict("REQUEST_CONFLICT")
        if state is None:
            state = store.create(request)
        if _terminal(state):
            return state
        config_path = config.get("_config_path", PRODUCTION_CONFIG)
        try:
            if not unit_manager.is_active(request.key):
                try:
                    unit_manager.start(request.key, config_path)
                except DeployError:
                    if not unit_manager.is_active(request.key):
                        raise
        except DeployError as error:
            if _transaction_requires_recovery(store.get(request.key)):
                raise
            return store.update(request.key, status="FAILED", code=error.code, phase="launch_failed")
    try:
        return unit_manager.wait(request.key, store, config_path)
    except DeployError as error:
        if _transaction_requires_recovery(store.get(request.key)):
            raise
        return store.update(request.key, status="FAILED", code=error.code, phase="wait_failed")


def run_transaction(request, config, backend, store):
    """Run deploy transaction or recover its journal after process interruption."""
    state = store.get(request.key)
    if state is None:
        state = store.create(request)
    if state.get("request") != request.as_dict():
        raise RequestConflict("REQUEST_CONFLICT")
    if _terminal(state):
        return state

    phase = state.get("phase", "accepted")
    if phase not in ("accepted", "lock_acquired", "image_verified", "compose_validated", "main_checked"):
        with _ignore_transaction_signals():
            return _recover_interrupted(request, config, backend, store, state)

    image_ref = request.image_ref
    prior = None
    app_stop_attempted = False
    backup_path = None
    try:
        with backend.transaction_lock():
            store.update(request.key, phase="lock_acquired")
            backend.pull_and_verify(image_ref, request, config)
            store.update(request.key, phase="image_verified")
            prior = backend.validate_compose(config, request, image_ref)
            store.update(request.key, phase="compose_validated", prior_state=_safe_prior_state(prior))
            fixture_expected = config.get("fixture_expected_source_sha") if config.get("profile") == "fixture" else None
            try:
                current_sha = backend.current_main_sha()
            except DeployError:
                if fixture_expected != request.source_sha:
                    raise
                current_sha = fixture_expected
            if current_sha != request.source_sha:
                return store.update(request.key, status="SKIPPED_STALE", phase="stale_source", code=None)
            store.update(request.key, phase="main_checked")

            backend.assert_app_unchanged(prior, config)
            backend.assert_redis_unchanged(prior, config)
            app_stop_attempted = True
            # AICODE-NOTE: Journal before Docker stop; a timeout can arrive after the daemon stopped the app.
            store.update(request.key, phase="stopping_app", app_stop_attempted=True)
            backend.stop_app()
            store.update(request.key, phase="app_stopped")

            backup_path = store.backup_path(request.key)
            store.update(request.key, phase="backup_creating", backup_path=backup_path)
            try:
                backend.create_backup(backup_path)
                backend.secure_backup(backup_path)
                backup_sha = backend.hash_file(backup_path)
                backend.validate_database(
                    backup_path,
                    prior["prior_image"],
                    config,
                    live=False,
                    require_migration_coverage=False,
                )
            except Exception:
                return _recover_without_candidate(request, config, backend, store, prior, "BACKUP_FAILED")

            store.update(
                request.key,
                phase="backup_validated",
                backup_path=backup_path,
                backup_sha256=backup_sha,
                db_metadata={
                    "db_uid": prior["db_uid"],
                    "db_gid": prior["db_gid"],
                    "db_mode": prior["db_mode"],
                },
            )
            candidate_path = store.candidate_override_path(request.key)
            backend.set_candidate_override(candidate_path, image_ref, config)
            # AICODE-NOTE: Persist before Compose up because its CLI may time out after migrations start writing.
            store.update(
                request.key,
                phase="candidate_may_mutate",
                candidate_may_mutate=True,
                candidate_override_path=candidate_path,
            )
            backend.start_candidate(candidate_path, image_ref, config)
            store.update(request.key, phase="candidate_started")
            backend.accept_candidate(image_ref, config, prior, time.monotonic() + _candidate_budget_seconds(config, backend))
            store.update(request.key, phase="candidate_accepted")
            backend.persist_candidate_override(image_ref, config)
            backend.assert_redis_unchanged(prior, config)
            store.update(request.key, status="SUCCEEDED", phase="complete", code=None, rollback_succeeded=None)
            return store.get(request.key)
    except (KeyboardInterrupt, TransactionInterrupted):
        with _ignore_transaction_signals():
            return _recover_interrupted(request, config, backend, store, store.get(request.key))
    except Exception as error:
        code = error.code if isinstance(error, DeployError) else "INTERNAL_ERROR"
        state = store.get(request.key) or {}
        if prior is None:
            prior = _load_prior_state(state)
        state_phase = state.get("phase")
        if app_stop_attempted or state_phase in ("stopping_app", "app_stopped", "backup_validated", "candidate_may_mutate", "candidate_started", "candidate_accepted"):
            if state.get("candidate_may_mutate") and prior:
                with _ignore_transaction_signals():
                    return _rollback_candidate(request, config, backend, store, prior, code)
            if prior:
                with _ignore_transaction_signals():
                    return _recover_without_candidate(request, config, backend, store, prior, code)
        return store.update(request.key, status="FAILED", code=code, phase="failed_before_stop")


def _candidate_budget_seconds(config, backend):
    health = backend.health_budget(config)
    return health + ROUTE_PROBE_TIMEOUT_SECONDS + SQLITE_OPERATION_TIMEOUT_SECONDS


def _safe_prior_state(prior):
    return {
        "prior_image": prior["prior_image"],
        "prior_image_id": prior["prior_image_id"],
        "prior_override_b64": base64.b64encode(prior["prior_override"]).decode("ascii"),
        "app_identity": prior["app_identity"],
        "redis_identity": prior["redis_identity"],
        "db_uid": prior["db_uid"],
        "db_gid": prior["db_gid"],
        "db_mode": prior["db_mode"],
    }


def _load_prior_state(state):
    value = state.get("prior_state") if isinstance(state, dict) else None
    if not isinstance(value, dict):
        return None
    try:
        override = base64.b64decode(value["prior_override_b64"].encode("ascii"), validate=True)
    except Exception:
        raise DeployError("STATE_INVALID")
    return {
        "prior_image": value["prior_image"],
        "prior_image_id": value["prior_image_id"],
        "prior_override": override,
        "app_identity": value["app_identity"],
        "redis_identity": value["redis_identity"],
        "db_uid": value["db_uid"],
        "db_gid": value["db_gid"],
        "db_mode": value["db_mode"],
    }


def _recover_without_candidate(request, config, backend, store, prior, primary_code):
    try:
        store.update(request.key, phase="restarting_prior_without_restore", candidate_may_mutate=False)
        backend.restore_prior_override(prior["prior_override"], config)
        backend.start_prior_image(prior["prior_image"], config)
        backend.verify_prior_service(prior["prior_image"], config, time.monotonic() + _rollback_health_budget(backend, config))
        return store.update(
            request.key,
            status="FAILED",
            phase="failed_rolled_back_without_db_restore",
            code=primary_code,
            rollback_succeeded=True,
        )
    except Exception:
        try:
            backend.stop_app()
        except Exception:
            pass
        return store.update(
            request.key,
            status="FAILED",
            phase="rollback_failed",
            code="ROLLBACK_FAILED",
            rollback_succeeded=False,
        )


def _rollback_health_budget(backend, config):
    try:
        return backend.health_budget(config) + ROUTE_PROBE_TIMEOUT_SECONDS + SQLITE_OPERATION_TIMEOUT_SECONDS
    except Exception:
        return 120 + ROUTE_PROBE_TIMEOUT_SECONDS + SQLITE_OPERATION_TIMEOUT_SECONDS


def _rollback_candidate(request, config, backend, store, prior, primary_code):
    state = store.get(request.key) or {}
    backup_path = state.get("backup_path")
    expected_backup_sha = state.get("backup_sha256")
    try:
        if not backup_path or not expected_backup_sha or _file_sha256(backup_path) != expected_backup_sha:
            raise DeployError("BACKUP_INVALID")
        store.update(request.key, phase="rollback_stopping_candidate")
        backend.stop_app()
        try:
            diagnostic_record = backend.preserve_failed_database(store.diagnostic_path(request.key), config)
            if isinstance(diagnostic_record, dict):
                store.update(
                    request.key,
                    diagnostic_record=diagnostic_record,
                    diagnostic_sha256=diagnostic_record.get("sha256"),
                )
            elif diagnostic_record:
                store.update(request.key, diagnostic_sha256=diagnostic_record)
        except Exception:
            store.update(request.key, diagnostic_copy_failed=True)
            # AICODE-NOTE: Never discard candidate SQLite/WAL state unless a root-only diagnostic copy exists.
            raise DeployError("DIAGNOSTIC_COPY_FAILED")
        backend.clear_database_sidecars(config)
        store.update(request.key, phase="restoring_database")
        backend.restore_database(backup_path, config, state.get("db_metadata", {}))
        restored_sha = backend.hash_file(config["database_path"])
        if restored_sha != expected_backup_sha:
            raise DeployError("RESTORED_HASH_MISMATCH")
        store.update(request.key, phase="database_restored", restored_db_sha256=restored_sha)
        backend.validate_database(
            config["database_path"],
            prior["prior_image"],
            config,
            live=False,
            require_migration_coverage=False,
        )
        backend.restore_prior_override(prior["prior_override"], config)
        backend.assert_image_id(prior["prior_image"], prior["prior_image_id"])
        store.update(request.key, phase="restarting_prior")
        backend.start_prior_image(prior["prior_image"], config)
        backend.verify_prior_service(prior["prior_image"], config, time.monotonic() + _rollback_health_budget(backend, config))
        return store.update(
            request.key,
            status="FAILED",
            phase="failed_rolled_back",
            code=primary_code,
            rollback_succeeded=True,
            restored_db_sha256=restored_sha,
        )
    except Exception:
        try:
            backend.stop_app()
        except Exception:
            pass
        return store.update(
            request.key,
            status="FAILED",
            phase="rollback_failed",
            code="ROLLBACK_FAILED",
            rollback_succeeded=False,
        )


def _recover_interrupted(request, config, backend, store, state):
    if state is None or state.get("request") != request.as_dict():
        raise RequestConflict("REQUEST_CONFLICT")
    if _terminal(state):
        return state
    prior = _load_prior_state(state)
    if prior is None:
        return store.update(request.key, status="FAILED", phase="recovery_failed", code="RECOVERY_STATE_MISSING")
    if state.get("candidate_may_mutate"):
        return _rollback_candidate(request, config, backend, store, prior, "PROCESS_INTERRUPTED")
    return _recover_without_candidate(request, config, backend, store, prior, "PROCESS_INTERRUPTED")


class SystemdUnitManager(object):
    def __init__(self, transaction_program=TRANSACTION_PATH):
        self.transaction_program = transaction_program

    def _unit(self, key):
        return "omniroute-deploy-" + _safe_key(key) + ".service"

    def is_active(self, key):
        unit = self._unit(key)
        result = _run_command([SYSTEMCTL, "show", "--property=ActiveState", "--value", unit], 10, "SYSTEMD_STATUS_FAILED", allow_failure=True)
        state = result.decode("ascii", "ignore").strip()
        return state not in ("", "inactive", "failed", "dead")

    def start(self, key, config_path):
        unit = self._unit(key)
        _run_command([SYSTEMCTL, "reset-failed", unit], 10, "SYSTEMD_STATUS_FAILED", allow_failure=True)
        command = [
            SYSTEMD_RUN,
            "--unit=" + unit[:-8],
            "--property=Type=oneshot",
            "--property=TimeoutStartSec=infinity",
            "--property=TimeoutStopSec=infinity",
            "--no-block",
            self.transaction_program,
            "--transaction",
            key,
        ]
        if config_path != PRODUCTION_CONFIG:
            command.extend(["--config", config_path])
        _run_command(command, 15, "SYSTEMD_START_FAILED")

    def wait(self, key, store, config_path):
        recovery_restarts = 0
        while True:
            state = store.get(key)
            if _terminal(state):
                return state
            if not self.is_active(key):
                if recovery_restarts >= 2:
                    raise DeployError("UNIT_DIED")
                self.start(key, config_path)
                recovery_restarts += 1
            time.sleep(2)


class DeploymentTransaction(object):
    """Compatibility-free injected-backend transaction entry for focused tests."""

    @staticmethod
    def run(request, config, backend, store):
        return run_transaction(request, config, backend, store)


class DockerBackend(object):
    def __init__(self, config, request, store):
        self.config = config
        self.request = request
        self.store = store

    @contextlib.contextmanager
    def transaction_lock(self):
        path = self.config["lock_path"]
        parent = os.path.dirname(path)
        if not os.path.isdir(parent):
            raise DeployError("LOCK_UNAVAILABLE")
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                if error.errno in (errno.EACCES, errno.EAGAIN):
                    raise DeployError("LOCK_BUSY")
                raise DeployError("LOCK_UNAVAILABLE")
            yield
        finally:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)

    def pull_and_verify(self, image_ref, request, config):
        if image_ref != IMAGE_REPOSITORY + "@" + request.digest:
            raise DeployError("IMAGE_REFERENCE_INVALID")
        transaction_dir = os.path.dirname(self.store.backup_path(request.key))
        docker_config = tempfile.mkdtemp(prefix="anonymous-pull-", dir=transaction_dir)
        os.chmod(docker_config, 0o700)
        os.chown(docker_config, 0, 0)
        config_file = os.path.join(docker_config, "config.json")
        descriptor = os.open(config_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(b"{}\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            _run_command([DOCKER, "--config", docker_config, "pull", image_ref], PULL_TIMEOUT_SECONDS, "IMAGE_PULL_FAILED")
        finally:
            shutil.rmtree(docker_config, ignore_errors=True)
        inspected = self._inspect_image(image_ref)
        if inspected.get("Architecture") != "arm64" or inspected.get("Os") != "linux":
            raise DeployError("IMAGE_ARCH_INVALID")
        repo_digests = inspected.get("RepoDigests") or []
        if IMAGE_REPOSITORY + "@" + request.digest not in repo_digests:
            raise DeployError("IMAGE_DIGEST_MISMATCH")
        labels = (inspected.get("Config") or {}).get("Labels") or {}
        if labels.get("org.opencontainers.image.source") != SOURCE_REPOSITORY:
            raise DeployError("IMAGE_SOURCE_MISMATCH")
        if labels.get("org.opencontainers.image.revision") != request.source_sha:
            raise DeployError("IMAGE_REVISION_MISMATCH")
        if labels.get("org.opencontainers.image.base.digest") != OFFICIAL_BASE_DIGEST:
            raise DeployError("IMAGE_BASE_MISMATCH")
        if not re.match(r"^sha256:[0-9a-f]{64}$", inspected.get("Id", "")):
            raise DeployError("IMAGE_ID_INVALID")

    def validate_compose(self, config, request, image_ref):
        self._validate_config_files(config)
        stable_config = self._compose_config(config)
        app = self._inspect_container(config["app_container"])
        redis = self._inspect_container(config["redis_container"])
        app_labels = (app.get("Config") or {}).get("Labels") or {}
        redis_labels = (redis.get("Config") or {}).get("Labels") or {}
        if app_labels.get("com.docker.compose.service") != config["app_service"]:
            raise DeployError("APP_SERVICE_MISMATCH")
        if redis_labels.get("com.docker.compose.service") != config["redis_service"]:
            raise DeployError("REDIS_SERVICE_MISMATCH")
        if app_labels.get("com.docker.compose.project") != config["compose_project_name"] or redis_labels.get("com.docker.compose.project") != config["compose_project_name"]:
            raise DeployError("COMPOSE_PROJECT_MISMATCH")
        services = stable_config.get("services") or {}
        for service_name, container in (
            (config["app_service"], app),
            (config["redis_service"], redis),
        ):
            service = services.get(service_name)
            if not isinstance(service, dict):
                raise DeployError("COMPOSE_SERVICE_INVALID")
            service_image_ref = service.get("image")
            if not isinstance(service_image_ref, str) or not service_image_ref:
                raise DeployError("COMPOSE_IMAGE_INVALID")
            image = self._inspect_image(service_image_ref)
            _assert_service_runtime_projection(service_name, stable_config, container, image, config)
        app_config_image = (app.get("Config") or {}).get("Image")
        app_image = app.get("Image")
        self._validate_baseline_app_noop(config)
        metadata = os.lstat(config["database_path"])
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise DeployError("DATABASE_PATH_INVALID")
        candidate_override = _candidate_override(config["app_service"], image_ref)
        candidate_config = self._compose_config(config, stdin_override=candidate_override)
        _assert_candidate_image_only(stable_config, candidate_config, config["app_service"], request.image_ref)
        self._validate_rendered_paths(config, stable_config)
        prior_override = _read_regular_file(config["image_override_path"], max_bytes=16384)
        _validate_prior_override(prior_override, config["app_service"])
        return {
            "prior_image": app_config_image,
            "prior_image_id": app_image,
            "prior_override": prior_override,
            "app_identity": _container_identity(app),
            "redis_identity": _container_identity(redis),
            "db_uid": metadata.st_uid,
            "db_gid": metadata.st_gid,
            "db_mode": stat.S_IMODE(metadata.st_mode),
        }

    def current_main_sha(self):
        request = urllib.request.Request(PUBLIC_MAIN_API, headers={"Accept": "application/vnd.github+json", "User-Agent": "omniroute-production-deploy"})
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            response = opener.open(request, timeout=API_TIMEOUT_SECONDS)
            try:
                payload = response.read(65536)
            finally:
                response.close()
            data = json.loads(payload.decode("utf-8"))
        except Exception:
            raise DeployError("GITHUB_MAIN_UNAVAILABLE")
        sha = ((data.get("object") or {}).get("sha")) if isinstance(data, dict) else None
        if not isinstance(sha, str) or not SHA_PATTERN.match(sha):
            raise DeployError("GITHUB_MAIN_INVALID")
        return sha

    def assert_redis_unchanged(self, prior, config):
        container = self._inspect_container(config["redis_container"])
        if _container_identity(container) != prior["redis_identity"]:
            raise DeployError("REDIS_CHANGED")

    def assert_app_unchanged(self, prior, config):
        container = self._inspect_container(config["app_container"])
        if _container_identity(container) != prior["app_identity"]:
            raise DeployError("APP_CHANGED")

    def stop_app(self):
        try:
            _run_command(self._compose_command(self.config) + ["stop", self.config["app_service"]], 55, "APP_STOP_FAILED")
        except DeployError:
            pass
        try:
            if self._inspect_container(self.config["app_container"]).get("State", {}).get("Running") is False:
                return
        except DeployError:
            pass
        try:
            _run_command(
                [DOCKER, "stop", "--time", "45", self.config["app_container"]],
                55,
                "APP_STOP_FAILED",
            )
            if self._inspect_container(self.config["app_container"]).get("State", {}).get("Running") is False:
                return
        except DeployError:
            pass
        raise DeployError("APP_STOP_FAILED")

    def create_backup(self, backup_path):
        _ensure_private_directory(os.path.dirname(backup_path), 0o700)
        if not _is_inside(backup_path, self.config["backup_root"]):
            raise DeployError("BACKUP_PATH_INVALID")
        sqlite_command = ".backup %s" % backup_path
        _run_command([SQLITE3, "-readonly", self.config["database_path"], sqlite_command], SQLITE_OPERATION_TIMEOUT_SECONDS, "BACKUP_FAILED")
        if not os.path.isfile(backup_path) or os.path.getsize(backup_path) < 100:
            raise DeployError("BACKUP_EMPTY")

    def secure_backup(self, backup_path):
        if not _is_inside(backup_path, self.config["backup_root"]):
            raise DeployError("BACKUP_PATH_INVALID")
        os.chown(backup_path, 0, 0)
        os.chmod(backup_path, 0o600)

    def hash_file(self, path):
        return _file_sha256(path)

    def validate_database(self, path, image_ref, config, live, require_migration_coverage):
        report = self._database_report(path, image_ref, config, live)
        if report.get("integrityOk") is not True or report.get("foreignKeyViolationCount") != 0:
            raise DeployError("DATABASE_INVALID")
        if require_migration_coverage and report.get("migrationCoverageOk") is not True:
            raise DeployError("MIGRATION_COVERAGE_INVALID")

    def set_candidate_override(self, path, image_ref, config):
        if not _is_inside(path, config["candidate_root"]):
            raise DeployError("CANDIDATE_OVERRIDE_INVALID")
        _write_atomic(path, _candidate_override(config["app_service"], image_ref), 0o600)

    def start_candidate(self, path, image_ref, config):
        if not _is_inside(path, config["candidate_root"]):
            raise DeployError("CANDIDATE_OVERRIDE_INVALID")
        _run_command(
            self._compose_command(config, extra_file=path)
            + ["up", "-d", "--no-build", "--no-deps", "--pull", "never", config["app_service"]],
            COMPOSE_START_TIMEOUT_SECONDS,
            "CANDIDATE_START_FAILED",
        )

    def accept_candidate(self, image_ref, config, prior, deadline):
        container = config["app_container"]
        self._wait_health(container, config, deadline)
        self._wait_routes(config, deadline, include_public=True)
        self.validate_database(
            config["database_path"],
            image_ref,
            config,
            live=True,
            require_migration_coverage=True,
        )
        self.assert_redis_unchanged(prior, config)
        app = self._inspect_container(container)
        labels = (app.get("Config") or {}).get("Labels") or {}
        if app.get("Image") != self._inspect_image(image_ref).get("Id"):
            raise DeployError("CANDIDATE_IMAGE_MISMATCH")
        if labels.get("org.opencontainers.image.source") != SOURCE_REPOSITORY or labels.get("org.opencontainers.image.revision") != self.request.source_sha:
            raise DeployError("CANDIDATE_REVISION_MISMATCH")
        if labels.get("org.opencontainers.image.base.digest") != OFFICIAL_BASE_DIGEST:
            raise DeployError("CANDIDATE_BASE_MISMATCH")

    def persist_candidate_override(self, image_ref, config):
        _write_atomic(config["image_override_path"], _candidate_override(config["app_service"], image_ref), 0o600)

    def preserve_failed_database(self, destination, config):
        if os.path.isfile(destination) and os.path.getsize(destination) >= 100:
            return {"format": "sqlite-backup", "sha256": _file_sha256(destination)}
        temporary = destination + ".tmp"
        try:
            self.create_backup(temporary)
            os.chmod(temporary, 0o600)
            os.chown(temporary, 0, 0)
            os.replace(temporary, destination)
            return {"format": "sqlite-backup", "sha256": _file_sha256(destination)}
        except Exception:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            return self._preserve_raw_database_triplet(destination, config)

    def _preserve_raw_database_triplet(self, destination, config):
        raw_directory = destination + ".raw"
        _ensure_private_directory(raw_directory, 0o700)
        raw_files = []
        for suffix, name in (
            ("", "storage.sqlite"),
            ("-wal", "storage.sqlite-wal"),
            ("-shm", "storage.sqlite-shm"),
            ("-journal", "storage.sqlite-journal"),
        ):
            source_path = config["database_path"] + suffix
            try:
                source_fd = os.open(source_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            except OSError as error:
                if error.errno == errno.ENOENT and suffix:
                    continue
                raise DeployError("DB_DIAGNOSTIC_COPY_FAILED")
            temporary_path = None
            try:
                source_metadata = os.fstat(source_fd)
                if not stat.S_ISREG(source_metadata.st_mode):
                    raise DeployError("DB_DIAGNOSTIC_COPY_FAILED")
                descriptor, temporary_path = tempfile.mkstemp(prefix="." + name + ".", dir=raw_directory)
                os.fchmod(descriptor, 0o600)
                os.fchown(descriptor, 0, 0)
                source = os.fdopen(source_fd, "rb")
                source_fd = -1
                target = os.fdopen(descriptor, "wb")
                with source, target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
                    target.flush()
                    os.fsync(target.fileno())
                final_path = os.path.join(raw_directory, name)
                os.replace(temporary_path, final_path)
                temporary_path = None
                raw_files.append({"name": name, "sha256": _file_sha256(final_path)})
            except Exception:
                if source_fd >= 0:
                    os.close(source_fd)
                if temporary_path:
                    try:
                        os.unlink(temporary_path)
                    except OSError:
                        pass
                raise
        if not raw_files or raw_files[0]["name"] != "storage.sqlite":
            raise DeployError("DB_DIAGNOSTIC_COPY_FAILED")
        manifest = {
            "format": "raw-sqlite-files",
            "files": raw_files,
        }
        _write_atomic(os.path.join(raw_directory, "manifest.json"), (json.dumps(manifest, sort_keys=True) + "\n").encode("utf-8"), 0o600)
        return {"format": "raw-sqlite-files", "path": raw_directory, "files": raw_files}

    def clear_database_sidecars(self, config):
        for suffix in SQLITE_SIDECAR_SUFFIXES:
            path = config["database_path"] + suffix
            try:
                os.unlink(path)
            except OSError as error:
                if error.errno != errno.ENOENT:
                    raise DeployError("DB_SIDECAR_REMOVE_FAILED")

    def restore_database(self, backup_path, config, metadata):
        if not _is_inside(backup_path, config["backup_root"]):
            raise DeployError("BACKUP_PATH_INVALID")
        # AICODE-NOTE: A fresh same-directory file lets reattachment recover from a killed copy.
        temporary_fd = None
        temporary = None
        try:
            temporary_fd, temporary = tempfile.mkstemp(
                prefix=".omniroute-restore-" + self.request.key + "-",
                dir=os.path.dirname(config["database_path"]),
            )
            with os.fdopen(temporary_fd, "wb") as target, open(backup_path, "rb") as source:
                temporary_fd = None
                shutil.copyfileobj(source, target, 1024 * 1024)
                target.flush()
                os.fsync(target.fileno())
            os.chown(temporary, metadata["db_uid"], metadata["db_gid"])
            os.chmod(temporary, metadata["db_mode"])
            os.replace(temporary, config["database_path"])
            directory_fd = os.open(os.path.dirname(config["database_path"]), os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except Exception:
            if temporary_fd is not None:
                try:
                    os.close(temporary_fd)
                except OSError:
                    pass
            if temporary is not None:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
            raise DeployError("DB_RESTORE_FAILED")

    def restore_prior_override(self, override_bytes, config):
        _write_atomic(config["image_override_path"], override_bytes, 0o600)

    def assert_image_id(self, image_ref, expected_id):
        if self._inspect_image(image_ref).get("Id") != expected_id:
            raise DeployError("PRIOR_IMAGE_MISMATCH")

    def start_prior_image(self, image_ref, config):
        self.assert_image_id(image_ref, self._previous_image_id())
        _run_command(
            self._compose_command(config)
            + ["up", "-d", "--no-build", "--no-deps", "--pull", "never", config["app_service"]],
            COMPOSE_START_TIMEOUT_SECONDS,
            "ROLLBACK_START_FAILED",
        )

    def verify_prior_service(self, image_ref, config, deadline):
        self._wait_health(config["app_container"], config, deadline)
        self._wait_routes(config, deadline, include_public=False)
        self.validate_database(
            config["database_path"],
            image_ref,
            config,
            live=True,
            require_migration_coverage=True,
        )
        app = self._inspect_container(config["app_container"])
        if app.get("Image") != self._previous_image_id():
            raise DeployError("PRIOR_IMAGE_MISMATCH")
        state = self.store.get(self.request.key) or {}
        prior = _load_prior_state(state)
        if prior:
            self.assert_redis_unchanged(prior, config)

    def health_budget(self, config):
        app = self._inspect_container(config["app_container"])
        health = ((app.get("Config") or {}).get("Healthcheck"))
        if not isinstance(health, dict):
            raise DeployError("HEALTHCHECK_MISSING")
        interval = _nanoseconds_seconds(health.get("Interval"))
        timeout = _nanoseconds_seconds(health.get("Timeout"))
        start_period = _nanoseconds_seconds(health.get("StartPeriod"))
        retries = health.get("Retries")
        if interval <= 0 or timeout <= 0 or not isinstance(retries, int) or retries < 1 or retries > 20:
            raise DeployError("HEALTHCHECK_INVALID")
        return start_period + retries * (interval + timeout)

    def _wait_health(self, container_name, config, deadline):
        budget = self.health_budget(config)
        health_deadline = min(deadline, time.monotonic() + budget)
        while time.monotonic() <= health_deadline:
            remaining = health_deadline - time.monotonic()
            if remaining <= 0:
                break
            container = self._inspect_container(container_name, timeout=min(10, remaining))
            health = ((container.get("State") or {}).get("Health") or {}).get("Status")
            if health == "healthy":
                return
            if health == "unhealthy":
                raise DeployError("APP_UNHEALTHY")
            time.sleep(min(5, max(0, health_deadline - time.monotonic())))
        raise DeployError("APP_HEALTH_TIMEOUT")

    def _wait_routes(self, config, deadline, include_public):
        route_deadline = min(deadline, time.monotonic() + ROUTE_PROBE_TIMEOUT_SECONDS)
        last_code = "ROUTE_CHECK_FAILED"
        while time.monotonic() <= route_deadline:
            try:
                remaining = route_deadline - time.monotonic()
                if remaining <= 0:
                    raise DeployError("ROUTE_UNAVAILABLE")
                self._probe_container_routes(
                    config["app_container"],
                    min(LOCAL_ROUTE_PROBE_TIMEOUT_SECONDS, remaining),
                )
                if include_public:
                    timeout = _remaining_probe_timeout(route_deadline)
                    _http_expect(
                        config["public_dashboard_url"],
                        200,
                        timeout,
                        error_code="PUBLIC_DASHBOARD_HTTP_INVALID",
                    )
                return
            except DeployError as error:
                last_code = error.code
                time.sleep(min(5, max(0, route_deadline - time.monotonic())))
        raise DeployError(last_code)

    def _probe_container_routes(self, container_name, timeout):
        output = _run_command(
            [DOCKER, "exec", container_name, "node", "-e", LOCAL_ROUTE_PROBE_SCRIPT],
            timeout,
            "LOCAL_ROUTE_PROBE_FAILED",
        )
        if output != LOCAL_ROUTE_PROBE_SUCCESS:
            raise DeployError("LOCAL_ROUTE_PROBE_INVALID")

    def _snapshot_validation_metadata(self, database_path):
        try:
            metadata = os.lstat(database_path)
        except OSError:
            raise DeployError("DATABASE_PATH_INVALID")
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise DeployError("DATABASE_PATH_INVALID")
        if any(os.path.lexists(database_path + suffix) for suffix in SQLITE_SIDECAR_SUFFIXES):
            raise DeployError("DATABASE_SIDECAR_PRESENT")
        try:
            digest = _file_sha256(database_path)
        except OSError:
            raise DeployError("DATABASE_PATH_INVALID")
        return metadata, digest

    def _finish_snapshot_validation(self, database_path, expected_metadata, expected_digest):
        cleanup_failed = False
        for suffix in SQLITE_SIDECAR_SUFFIXES:
            sidecar_path = database_path + suffix
            if not os.path.lexists(sidecar_path):
                continue
            try:
                sidecar_metadata = os.lstat(sidecar_path)
            except OSError:
                cleanup_failed = True
                continue
            if (
                not stat.S_ISREG(sidecar_metadata.st_mode)
                or sidecar_metadata.st_uid != expected_metadata.st_uid
                or sidecar_metadata.st_gid != expected_metadata.st_gid
            ):
                cleanup_failed = True
                continue
            try:
                os.unlink(sidecar_path)
                if os.path.lexists(sidecar_path):
                    cleanup_failed = True
            except OSError:
                cleanup_failed = True

        try:
            current_metadata = os.lstat(database_path)
            source_unchanged = not (
                stat.S_ISLNK(current_metadata.st_mode)
                or not stat.S_ISREG(current_metadata.st_mode)
                or current_metadata.st_dev != expected_metadata.st_dev
                or current_metadata.st_ino != expected_metadata.st_ino
                or current_metadata.st_uid != expected_metadata.st_uid
                or current_metadata.st_gid != expected_metadata.st_gid
                or stat.S_IMODE(current_metadata.st_mode) != stat.S_IMODE(expected_metadata.st_mode)
                or _file_sha256(database_path) != expected_digest
            )
        except OSError:
            source_unchanged = False
        if not source_unchanged:
            raise DeployError("DATABASE_CHECK_MUTATED")
        if cleanup_failed:
            raise DeployError("DATABASE_SIDECAR_CLEANUP_FAILED")

    def _database_report(self, database_path, image_ref, config, live):
        snapshot_metadata = None
        snapshot_digest = None
        if live:
            try:
                live_metadata = os.lstat(database_path)
                file_mode = live_metadata.st_mode
                uid, gid = live_metadata.st_uid, live_metadata.st_gid
            except (AttributeError, OSError):
                raise DeployError("DATABASE_PATH_INVALID")
            if stat.S_ISLNK(file_mode) or not stat.S_ISREG(file_mode):
                raise DeployError("DATABASE_PATH_INVALID")
            if type(uid) is not int or type(gid) is not int or uid < 0 or gid < 0:
                raise DeployError("DATABASE_PATH_INVALID")
            # AICODE-NOTE: Match DB ownership so a cap-dropped readonly checker can read the live WAL/SHM.
            mount_source = config["data_dir"]
            container_database = "/tmp/omniroute-data/storage.sqlite"
            container_user = "%d:%d" % (uid, gid)
            mount_readonly = True
        else:
            if not os.path.isfile(database_path):
                raise DeployError("DATABASE_PATH_INVALID")
            # AICODE-NOTE: SQLite remains readonly but needs a writable parent for WAL sidecars on snapshots.
            snapshot_metadata, snapshot_digest = self._snapshot_validation_metadata(database_path)
            mount_source = os.path.dirname(database_path)
            container_database = "/tmp/omniroute-backup/" + os.path.basename(database_path)
            container_user = "%s:%s" % (snapshot_metadata.st_uid, snapshot_metadata.st_gid)
            mount_readonly = False
        mount_target = os.path.dirname(container_database)
        mount = "type=bind,src=%s,dst=%s" % (mount_source, mount_target)
        if mount_readonly:
            mount += ",readonly"
        command = [
            DOCKER,
            "run",
            "-i",
            "--pull=never",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--user",
            container_user,
            "--mount",
            mount,
            "--workdir",
            "/app",
            "--entrypoint",
            "node",
            image_ref,
            "-",
            container_database,
        ]
        try:
            with open(config["migration_catalog_path"], "rb") as source:
                script = source.read(65536)
        except IOError:
            raise DeployError("MIGRATION_CATALOG_UNAVAILABLE")
        try:
            output = _run_command(command, SQLITE_OPERATION_TIMEOUT_SECONDS, "DATABASE_CHECK_FAILED", input_data=script)
        finally:
            if not live:
                self._finish_snapshot_validation(database_path, snapshot_metadata, snapshot_digest)
        try:
            report = json.loads(output.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise DeployError("DATABASE_CHECK_INVALID")
        if not isinstance(report, dict):
            raise DeployError("DATABASE_CHECK_INVALID")
        return report

    def _validate_config_files(self, config):
        for path in config["compose_files"]:
            metadata = os.lstat(path)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0:
                raise DeployError("COMPOSE_INPUT_INVALID")
            if stat.S_IMODE(metadata.st_mode) & 0o022:
                raise DeployError("COMPOSE_INPUT_WRITABLE")
        override = config["image_override_path"]
        if config.get("profile") == "production" and not _is_inside(override, PRODUCTION_COMPOSE_ROOT):
            raise DeployError("COMPOSE_INPUT_INVALID")

    def _validate_rendered_paths(self, config, rendered):
        services = rendered.get("services") or {}
        if not set((config["app_service"], config["redis_service"])).issubset(services):
            raise DeployError("COMPOSE_SERVICE_SET_CHANGED")
        app = services.get(config["app_service"]) or {}
        redis = services.get(config["redis_service"]) or {}
        if app.get("container_name") != config["app_container"] or redis.get("container_name") != config["redis_container"]:
            raise DeployError("COMPOSE_CONTAINER_NAME_MISMATCH")
        if config.get("profile") == "fixture":
            networks = rendered.get("networks") or {}
            if not networks or any(
                not isinstance(network, dict) or network.get("internal") is not True or network.get("external")
                for network in networks.values()
            ):
                raise DeployError("FIXTURE_NETWORK_NOT_ISOLATED")
            if rendered.get("volumes"):
                raise DeployError("FIXTURE_NAMED_VOLUME_FORBIDDEN")
        found_data_dir = False
        for service_name, service in services.items():
            if config.get("profile") == "fixture":
                labels = service.get("labels") or {}
                if isinstance(labels, list):
                    labels = dict(label.split("=", 1) for label in labels if "=" in label)
                if (
                    service.get("network_mode")
                    or service.get("privileged") is True
                    or service.get("pid") == "host"
                    or service.get("ipc") == "host"
                    or service.get("devices")
                    or service.get("build")
                    or any(str(label).lower().startswith("traefik.") for label in labels)
                ):
                    raise DeployError("FIXTURE_SERVICE_NOT_ISOLATED")
                if service.get("ports"):
                    raise DeployError("FIXTURE_PORT_PUBLISHING_FORBIDDEN")
            for volume in service.get("volumes") or []:
                if isinstance(volume, dict) and volume.get("type") == "bind":
                    source = volume.get("source")
                elif isinstance(volume, str) and os.path.isabs(volume.split(":", 1)[0]):
                    source = volume.split(":", 1)[0]
                else:
                    if config.get("profile") == "fixture" and not (
                        isinstance(volume, dict) and volume.get("type") == "tmpfs"
                    ):
                        raise DeployError("FIXTURE_VOLUME_OUTSIDE_ROOT")
                    continue
                if service_name == config["app_service"] and os.path.realpath(source) == os.path.realpath(config["data_dir"]):
                    found_data_dir = True
                if config.get("profile") == "fixture" and not _is_inside(source, config["fixture_root"]):
                    raise DeployError("FIXTURE_MOUNT_ESCAPE")
        if not found_data_dir:
            raise DeployError("DATABASE_MOUNT_MISSING")
    def _compose_command(self, config, extra_file=None, stdin_override=None):
        command = [DOCKER, "compose", "--project-name", config["compose_project_name"], "--project-directory", config["project_dir"]]
        for path in config["compose_files"]:
            command.extend(["-f", path])
        if extra_file is not None:
            command.extend(["-f", extra_file])
        elif stdin_override is not None:
            command.extend(["-f", "-"])
        return command

    def _validate_baseline_app_noop(self, config):
        command = self._compose_command(config)
        command.insert(2, "--dry-run")
        command[3:3] = ["--progress", "plain"]
        command.extend(["up", "-d", "--no-deps", "--no-build", "--pull", "never", config["app_service"]])
        # AICODE-NOTE: Compose writes the dry-run plan to stderr; merge only for this strict no-op check.
        output = _run_command(command, 30, "COMPOSE_DRY_RUN_FAILED", merge_stderr=True)
        _assert_app_dry_run_noop(output, config["app_container"])

    def _compose_config(self, config, extra_file=None, stdin_override=None):
        output = _run_command(self._compose_command(config, extra_file, stdin_override) + ["config", "--format", "json"], 30, "COMPOSE_RENDER_FAILED", input_data=stdin_override)
        try:
            return json.loads(output.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise DeployError("COMPOSE_RENDER_INVALID")

    def _inspect_image(self, image_ref):
        output = _run_command([DOCKER, "image", "inspect", image_ref], 30, "IMAGE_INSPECT_FAILED")
        try:
            values = json.loads(output.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise DeployError("IMAGE_INSPECT_INVALID")
        if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], dict):
            raise DeployError("IMAGE_INSPECT_INVALID")
        return values[0]

    def _inspect_container(self, name, timeout=20):
        output = _run_command([DOCKER, "inspect", name], timeout, "CONTAINER_INSPECT_FAILED")
        try:
            values = json.loads(output.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise DeployError("CONTAINER_INSPECT_INVALID")
        if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], dict):
            raise DeployError("CONTAINER_INSPECT_INVALID")
        return values[0]

    def _previous_image_id(self):
        state = self.store.get(self.request.key)
        prior = _load_prior_state(state or {})
        if prior is None:
            raise DeployError("STATE_INVALID")
        return prior["prior_image_id"]


def _container_identity(container):
    state = container.get("State") or {}
    health = state.get("Health") or {}
    runtime = container.get("Config") or {}
    return {
        "id": container.get("Id"),
        "name": container.get("Name"),
        "image_ref": runtime.get("Image"),
        "image_id": container.get("Image"),
        "running": state.get("Running"),
        "status": state.get("Status"),
        "health_status": health.get("Status"),
    }


def _projection_error():
    raise DeployError("COMPOSE_RUNTIME_PROJECTION_INVALID")


def _projection_map(value, allow_none=False):
    if value is None and allow_none:
        return {}
    if not isinstance(value, dict):
        _projection_error()
    return value


def _projection_list(value):
    if not isinstance(value, list):
        _projection_error()
    return value


def _environment_projection(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        pairs = value.items()
    elif isinstance(value, list):
        pairs = []
        for item in value:
            if not isinstance(item, str) or "=" not in item:
                _projection_error()
            pairs.append(item.split("=", 1))
    else:
        _projection_error()
    result = {}
    for name, setting in pairs:
        if not isinstance(name, str) or not name or not isinstance(setting, str) or name in result:
            _projection_error()
        result[name] = setting
    return result


def _command_projection(value):
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        _projection_error()
    return list(value)


def _duration_projection(value):
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    if not isinstance(value, str):
        _projection_error()
    match = re.match(r"^([0-9]+)(ns|us|µs|ms|s|m|h)$", value)
    if not match:
        _projection_error()
    units = {
        "ns": 1,
        "us": 1000,
        "µs": 1000,
        "ms": 1000000,
        "s": 1000000000,
        "m": 60000000000,
        "h": 3600000000000,
    }
    return int(match.group(1)) * units[match.group(2)]


def _healthcheck_projection(value):
    value = _projection_map(value)
    if set(value) - {"test", "interval", "timeout", "retries", "start_period"}:
        _projection_error()
    test = _projection_list(value.get("test"))
    if not test or not all(isinstance(item, str) for item in test) or test == ["NONE"]:
        _projection_error()
    retries = value.get("retries")
    if not isinstance(retries, int) or isinstance(retries, bool) or retries < 0:
        _projection_error()
    return {
        "Test": list(test),
        "Interval": _duration_projection(value.get("interval", "0s")),
        "Timeout": _duration_projection(value.get("timeout", "0s")),
        "Retries": retries,
        "StartPeriod": _duration_projection(value.get("start_period", "0s")),
    }


def _native_healthcheck_projection(value):
    value = _projection_map(value)
    test = _projection_list(value.get("Test"))
    if not test or not all(isinstance(item, str) for item in test) or test == ["NONE"]:
        _projection_error()
    result = {"Test": list(test)}
    for source, target in (
        ("Interval", "Interval"),
        ("Timeout", "Timeout"),
        ("Retries", "Retries"),
        ("StartPeriod", "StartPeriod"),
    ):
        if source == "StartPeriod" and source not in value:
            # AICODE-NOTE: Docker omits the unset optional value; Compose defaults it to zero.
            result[target] = 0
            continue
        setting = value.get(source)
        if not isinstance(setting, int) or isinstance(setting, bool) or setting < 0:
            _projection_error()
        result[target] = setting
    if set(value) - {"Test", "Interval", "Timeout", "Retries", "StartPeriod"}:
        _projection_error()
    return result


def _label_projection(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        pairs = value.items()
    elif isinstance(value, list):
        pairs = []
        for item in value:
            if not isinstance(item, str) or "=" not in item:
                _projection_error()
            pairs.append(item.split("=", 1))
    else:
        _projection_error()
    result = {}
    for name, setting in pairs:
        if not isinstance(name, str) or not name or not isinstance(setting, str) or name in result:
            _projection_error()
        result[name] = setting
    return result


def _runtime_labels(value):
    return {
        name: setting
        for name, setting in _label_projection(value).items()
        if not name.startswith("com.docker.compose.")
    }


def _port_number(value, optional=False):
    if optional and value in (None, ""):
        return ""
    if isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    if (
        not isinstance(value, str)
        or not re.match(r"^[0-9]{1,5}$", value)
        or not 1 <= int(value) <= 65535
    ):
        _projection_error()
    return value


def _port_tuple(target, protocol, host_ip="", host_port=""):
    if protocol not in ("tcp", "udp", "sctp") or not isinstance(host_ip, str):
        _projection_error()
    return (
        _port_number(target),
        protocol,
        host_ip,
        _port_number(host_port, optional=True),
    )


def _compose_port_projection(service, image_config):
    ports = set()
    bindings = set()
    if service.get("expose"):
        _projection_error()
    for record in _projection_list(service.get("ports") or []):
        record = _projection_map(record)
        if set(record) - {"target", "published", "protocol", "host_ip", "mode"}:
            _projection_error()
        # AICODE-NOTE: Only the observed ingress binding mode is covered by this runtime projection.
        if record.get("mode") != "ingress":
            _projection_error()
        protocol = record.get("protocol", "tcp")
        host_ip = record.get("host_ip", "")
        if not isinstance(protocol, str) or not protocol or not isinstance(host_ip, str):
            _projection_error()
        published = _port_number(record.get("published"), optional=True)
        port = _port_tuple(record.get("target"), protocol, host_ip, published)
        ports.add(port)
        if published:
            bindings.add(port)
    for port_spec in _projection_map(image_config.get("ExposedPorts"), allow_none=True):
        if not isinstance(port_spec, str):
            _projection_error()
        target, separator, protocol = port_spec.partition("/")
        if not separator:
            _projection_error()
        ports.add(_port_tuple(target, protocol))
    return ports, bindings


def _actual_port_projection(value):
    if value is None:
        return set()
    value = _projection_map(value)
    ports = set()
    for port_spec, bindings in value.items():
        if not isinstance(port_spec, str):
            _projection_error()
        target, separator, protocol = port_spec.partition("/")
        if not separator:
            _projection_error()
        if bindings is None:
            ports.add(_port_tuple(target, protocol))
            continue
        for binding in _projection_list(bindings):
            binding = _projection_map(binding)
            ports.add(_port_tuple(
                target,
                protocol,
                binding.get("HostIp", ""),
                binding.get("HostPort", ""),
            ))
    return ports


def _compose_bind_mounts(service):
    mounts = set()
    for mount in _projection_list(service.get("volumes") or []):
        mount = _projection_map(mount)
        if mount.get("type") != "bind":
            _projection_error()
        source = mount.get("source")
        target = mount.get("target")
        read_only = mount.get("read_only", False)
        if (
            not isinstance(source, str)
            or not os.path.isabs(source)
            or not isinstance(target, str)
            or not target
            or not isinstance(read_only, bool)
        ):
            _projection_error()
        bind = _projection_map(mount.get("bind"), allow_none=True)
        if set(bind) - {"create_host_path", "propagation"} or bind.get("create_host_path", True) is not True:
            _projection_error()
        propagation = bind.get("propagation") or "rprivate"
        if propagation != "rprivate":
            _projection_error()
        mounts.add((os.path.realpath(source), target, read_only, propagation))
    return mounts


def _actual_bind_mounts(value):
    mounts = set()
    for mount in _projection_list(value):
        mount = _projection_map(mount)
        if mount.get("Type") != "bind":
            _projection_error()
        source = mount.get("Source")
        target = mount.get("Destination")
        read_write = mount.get("RW")
        propagation = mount.get("Propagation") or "rprivate"
        if not isinstance(source, str) or not os.path.isabs(source) or not isinstance(target, str) or not isinstance(read_write, bool) or propagation != "rprivate":
            _projection_error()
        mounts.add((os.path.realpath(source), target, not read_write, propagation))
    return mounts


def _compose_networks(service, model, project_name):
    configured = _projection_map(service.get("networks"))
    definitions = _projection_map(model.get("networks"), allow_none=True)
    names = set()
    for network, options in configured.items():
        if _projection_map(options, allow_none=True):
            _projection_error()
        if network not in definitions:
            _projection_error()
        definition = _projection_map(definitions.get(network), allow_none=True)
        if set(definition) - {"name", "external", "driver", "ipam", "internal"}:
            _projection_error()
        if "internal" in definition and not isinstance(definition["internal"], bool):
            _projection_error()
        # AICODE-NOTE: Compose emits empty IPAM when no custom address pools are configured.
        if "ipam" in definition and (not isinstance(definition["ipam"], dict) or definition["ipam"]):
            _projection_error()
        driver = definition.get("driver")
        if driver is not None and (not isinstance(driver, str) or not driver):
            _projection_error()
        external = definition.get("external", False)
        if not isinstance(external, bool):
            _projection_error()
        name = definition.get("name")
        if name is None:
            name = network if external else project_name + "_" + network
        if not isinstance(name, str) or not name:
            _projection_error()
        names.add(name)
    return names


def _assert_service_runtime_projection(service_name, model, container, image, config):
    # AICODE-NOTE: Hash labels vary by Compose version and env-file resolution.
    # Compare the live services with the resolved protected model instead.
    try:
        model = _projection_map(model)
        service = _projection_map(_projection_map(model.get("services")).get(service_name))
        image_config = _projection_map(image.get("Config"))
        container_config = _projection_map(container.get("Config"))
        host_config = _projection_map(container.get("HostConfig"))
        state = _projection_map(container.get("State"))
        health_state = _projection_map(state.get("Health"))

        container_id = container.get("Id")
        image_id = image.get("Id")
        if not isinstance(container_id, str) or not re.match(r"^[a-f0-9]{64}$", container_id):
            _projection_error()
        if not isinstance(image_id, str) or not re.match(r"^sha256:[a-f0-9]{64}$", image_id):
            _projection_error()
        if state.get("Running") is not True or state.get("Status") != "running" or health_state.get("Status") != "healthy":
            raise DeployError("COMPOSE_RUNTIME_MISMATCH")

        container_name = service.get("container_name")
        image_ref = service.get("image")
        actual_name = container.get("Name")
        if not isinstance(container_name, str) or not isinstance(image_ref, str) or not isinstance(actual_name, str):
            _projection_error()
        if actual_name != "/" + container_name or container_config.get("Image") != image_ref or container.get("Image") != image_id:
            raise DeployError("COMPOSE_RUNTIME_MISMATCH")
        labels = _label_projection(container_config.get("Labels"))
        if labels.get("com.docker.compose.project") != config["compose_project_name"] or labels.get("com.docker.compose.service") != service_name:
            raise DeployError("COMPOSE_RUNTIME_MISMATCH")

        expected_env = _environment_projection(image_config.get("Env"))
        expected_env.update(_environment_projection(service.get("environment")))
        expected_command = service.get("command")
        if expected_command is None:
            expected_command = image_config.get("Cmd")
        expected_entrypoint = service.get("entrypoint")
        if expected_entrypoint is None:
            expected_entrypoint = image_config.get("Entrypoint")
        expected_command = _command_projection(expected_command)
        expected_entrypoint = _command_projection(expected_entrypoint)
        expected_user = service.get("user")
        if expected_user is None:
            expected_user = image_config.get("User", "")
        expected_working_dir = service.get("working_dir")
        if expected_working_dir is None:
            expected_working_dir = image_config.get("WorkingDir", "")
        if not isinstance(expected_user, str) or not isinstance(expected_working_dir, str):
            _projection_error()

        expected_init = service.get("init")
        actual_init = host_config.get("Init")
        if expected_init is not None and not isinstance(expected_init, bool):
            _projection_error()
        if actual_init is not None and not isinstance(actual_init, bool):
            _projection_error()
        expected_init = bool(expected_init)
        actual_init = bool(actual_init)
        expected_restart = service.get("restart") or "no"
        actual_restart = _projection_map(host_config.get("RestartPolicy")).get("Name") or "no"
        if not isinstance(expected_restart, str) or not isinstance(actual_restart, str):
            _projection_error()

        expected_health = _healthcheck_projection(service.get("healthcheck"))
        actual_health = _native_healthcheck_projection(container_config.get("Healthcheck"))

        expected_ports, expected_bindings = _compose_port_projection(service, image_config)
        network_settings = _projection_map(container.get("NetworkSettings"))
        actual_ports = _actual_port_projection(network_settings.get("Ports"))
        actual_bindings = _actual_port_projection(host_config.get("PortBindings"))
        if config.get("profile") == "fixture":
            if (
                service.get("ports")
                or expected_bindings
                or actual_bindings
                or not actual_ports.issubset(expected_ports)
            ):
                raise DeployError("COMPOSE_RUNTIME_MISMATCH")
            # AICODE-NOTE: Docker26 omits unbound image-exposed ports on internal networks.
            expected_ports = set()
            actual_ports = set()
            expected_bindings = set()
            actual_bindings = set()
        expected_labels = _label_projection(image_config.get("Labels"))
        expected_labels.update(_label_projection(service.get("labels")))
        expected_networks = _compose_networks(service, model, config["compose_project_name"])
        actual_networks = set(_projection_map(network_settings.get("Networks")))
        expected_mounts = _compose_bind_mounts(service)
        actual_mounts = _actual_bind_mounts(container.get("Mounts"))

        expected_projection = {
            "image_ref": image_ref,
            "image_id": image_id,
            "environment": expected_env,
            "command": expected_command,
            "entrypoint": expected_entrypoint,
            "user": expected_user,
            "working_dir": expected_working_dir,
            "init": expected_init,
            "restart": expected_restart,
            "healthcheck": expected_health,
            "health_status": health_state.get("Status"),
            "ports": expected_ports,
            "bindings": expected_bindings,
            "mounts": expected_mounts,
            "networks": expected_networks,
            "labels": _runtime_labels(expected_labels),
        }
        actual_projection = {
            "image_ref": container_config.get("Image"),
            "image_id": container.get("Image"),
            "environment": _environment_projection(container_config.get("Env")),
            "command": _command_projection(container_config.get("Cmd")),
            "entrypoint": _command_projection(container_config.get("Entrypoint")),
            "user": container_config.get("User"),
            "working_dir": container_config.get("WorkingDir"),
            "init": actual_init,
            "restart": actual_restart,
            "healthcheck": actual_health,
            "health_status": health_state.get("Status"),
            "ports": actual_ports,
            "bindings": actual_bindings,
            "mounts": actual_mounts,
            "networks": actual_networks,
            "labels": _runtime_labels(labels),
        }
    except DeployError:
        raise
    except Exception:
        _projection_error()
    if expected_projection != actual_projection:
        raise DeployError("COMPOSE_RUNTIME_MISMATCH")


def _assert_candidate_image_only(baseline, candidate, app_service, candidate_image):
    try:
        baseline = _projection_map(baseline)
        candidate = _projection_map(candidate)
        baseline_services = _projection_map(baseline.get("services"))
        candidate_services = _projection_map(candidate.get("services"))
        baseline_app = _projection_map(baseline_services.get(app_service))
        candidate_app = _projection_map(candidate_services.get(app_service))
        if candidate_app.get("image") != candidate_image:
            raise DeployError("CANDIDATE_IMAGE_NOT_PINNED")
        normalized_candidate = copy.deepcopy(candidate)
        normalized_candidate["services"][app_service]["image"] = baseline_app.get("image")
    except DeployError:
        raise
    except Exception:
        raise DeployError("COMPOSE_CANDIDATE_CONFIG_INVALID")
    if normalized_candidate != baseline:
        raise DeployError("COMPOSE_CANDIDATE_CONFIG_CHANGED")


def _assert_app_dry_run_noop(output, container_name):
    if not isinstance(output, bytes) or len(output) > 4096:
        raise DeployError("COMPOSE_DRY_RUN_INVALID")
    try:
        lines = output.decode("ascii", "strict").splitlines()
    except UnicodeDecodeError:
        raise DeployError("COMPOSE_DRY_RUN_INVALID")
    # AICODE-NOTE: Compose aligns columns with spaces; compare one plan's exact tokens.
    if len(lines) != 1 or lines[0].split() != ["DRY-RUN", "MODE", "-", "Container", container_name, "Running"]:
        raise DeployError("COMPOSE_BASELINE_NOT_STABLE")


def _candidate_override(service, image_ref):
    if not DIGEST_PATTERN.match(image_ref.split("@", 1)[-1]) or not image_ref.startswith(IMAGE_REPOSITORY + "@"):
        raise DeployError("IMAGE_REFERENCE_INVALID")
    if service != "omniroute":
        raise DeployError("APP_SERVICE_INVALID")
    return ("services:\n  omniroute:\n    image: %s\n" % image_ref).encode("ascii")


def _validate_prior_override(contents, service):
    if service != "omniroute" or not isinstance(contents, bytes) or len(contents) > 4096:
        raise DeployError("OVERRIDE_INVALID")
    try:
        text_value = contents.decode("ascii")
    except UnicodeDecodeError:
        raise DeployError("OVERRIDE_INVALID")
    lines = text_value.splitlines()
    if len(lines) != 3 or lines[0] != "services:" or lines[1] != "  omniroute:" or not lines[2].startswith("    image: "):
        raise DeployError("OVERRIDE_INVALID")
    image = lines[2][len("    image: "):]
    if not re.match(r"^ghcr\.io/etcetera-agency/omniroute(?::[A-Za-z0-9._-]+|@sha256:[0-9a-f]{64})$", image):
        raise DeployError("OVERRIDE_INVALID")
    if "\r" in text_value or "\x00" in text_value:
        raise DeployError("OVERRIDE_INVALID")


def _read_regular_file(path, max_bytes):
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode) or metadata.st_size > max_bytes:
        raise DeployError("OVERRIDE_INVALID")
    with open(path, "rb") as handle:
        return handle.read(max_bytes + 1)


def _nanoseconds_seconds(value):
    if not isinstance(value, (int, float)) or value < 0:
        return 0
    return float(value) / 1000000000.0


def _http_response(url, timeout):
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise DeployError("HEALTH_URL_INVALID")
    request = urllib.request.Request(url, headers={"User-Agent": "omniroute-deploy-health"})
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        response = opener.open(request, timeout=timeout)
        try:
            body = response.read(65536)
            return response.getcode(), body
        finally:
            response.close()
    except urllib.error.HTTPError as error:
        try:
            return error.code, error.read(65536)
        finally:
            error.close()
    except Exception:
        raise DeployError("ROUTE_UNAVAILABLE")


def _remaining_probe_timeout(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise DeployError("ROUTE_UNAVAILABLE")
    return min(5, remaining)


def _http_expect(url, expected_status, timeout, error_code=None):
    status, _body = _http_response(url, timeout)
    if status != expected_status:
        code = error_code or "DASHBOARD_HTTP_INVALID"
        raise DeployError(code)


def _run_command(argv, timeout, error_code, input_data=None, allow_failure=False, merge_stderr=False):
    if not argv or not all(isinstance(value, str) and "\x00" not in value for value in argv):
        raise DeployError("COMMAND_INVALID")
    process = subprocess.Popen(
        argv,
        stdin=subprocess.PIPE if input_data is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT if merge_stderr else subprocess.PIPE,
        close_fds=True,
        env={
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME": "/root",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
        },
    )
    try:
        stdout, _stderr = process.communicate(input_data, timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        raise DeployError(error_code)
    except BaseException:
        try:
            process.kill()
        except OSError:
            pass
        process.communicate()
        raise
    if process.returncode != 0 and not allow_failure:
        raise DeployError(error_code)
    return stdout


def _install_transaction_signal_handlers():
    def interrupted(_signum, _frame):
        raise TransactionInterrupted()

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)


@contextlib.contextmanager
def _ignore_transaction_signals():
    previous_term = signal.signal(signal.SIGTERM, signal.SIG_IGN)
    previous_int = signal.signal(signal.SIGINT, signal.SIG_IGN)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous_term)
        signal.signal(signal.SIGINT, previous_int)


def _load_store(config):
    return StateStore(config["state_root"], config["backup_root"])


def _read_stdin_request():
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    return parse_request(raw)


def _load_runtime_config(path, profile):
    config = load_config(path, profile)
    config["_config_path"] = path
    return config


def _execute_submit(request, config):
    store = _load_store(config)
    manager = SystemdUnitManager()
    try:
        state = submit_request(request, config, store, manager)
    except RequestConflict:
        return {"key": request.key, "status": "FAILED", "code": "REQUEST_CONFLICT"}
    return state


def _execute_transaction(key, config):
    _safe_key(key)
    if os.geteuid() != 0:
        raise ConfigurationError("root required")
    store = _load_store(config)
    state = store.get(key)
    if state is None:
        raise DeployError("STATE_MISSING")
    request = request_from_dict(state.get("request"))
    _install_transaction_signal_handlers()
    backend = DockerBackend(config, request, store)
    result = run_transaction(request, config, backend, store)
    if result.get("status") == "FAILED":
        return 1
    return 0


def _execute_ssh_gate():
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    return run_ssh_gate(
        os.environ.get("SSH_ORIGINAL_COMMAND", ""),
        raw,
        _sudo_execute,
        sys.stdout,
        sys.stderr,
    )


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv == ["--ssh-gate"]:
        return _execute_ssh_gate()
    if len(argv) >= 2 and argv[0] == "--transaction":
        key = argv[1]
        config_path = PRODUCTION_CONFIG
        if len(argv) == 4 and argv[2] == "--config":
            if os.geteuid() != 0:
                return 64
            config_path = argv[3]
        elif len(argv) != 2:
            return 64
        try:
            config = _load_runtime_config(config_path, "production" if config_path == PRODUCTION_CONFIG else "fixture")
            return _execute_transaction(key, config)
        except (ConfigurationError, DeployError, InvalidRequest):
            return 1
    if len(argv) == 2 and argv[0] == "--config":
        if os.geteuid() != 0:
            sys.stderr.write("root required\n")
            return 64
        config_path = argv[1]
        try:
            config = _load_runtime_config(config_path, "fixture")
            request = _read_stdin_request()
            result = _execute_submit(request, config)
            sys.stdout.write(_result_line(result, request.key))
            return 0 if result.get("status") in ("SUCCEEDED", "SKIPPED_STALE") else 1
        except InvalidRequest:
            sys.stderr.write("request rejected\n")
            return 64
        except ConfigurationError:
            sys.stderr.write("fixture configuration rejected\n")
            return 64
    if argv:
        return 64
    if os.geteuid() != 0:
        sys.stderr.write("root required\n")
        return 64
    try:
        request = _read_stdin_request()
    except InvalidRequest:
        sys.stderr.write("request rejected\n")
        return 64
    try:
        config = _load_runtime_config(PRODUCTION_CONFIG, "production")
        result = _execute_submit(request, config)
        sys.stdout.write(_result_line(result, request.key))
        return 0 if result.get("status") in ("SUCCEEDED", "SKIPPED_STALE") else 1
    except ConfigurationError:
        sys.stdout.write("FAILED %s CONFIGURATION_INVALID\n" % request.key)
        return 1
    except DeployError as error:
        sys.stdout.write("FAILED %s %s\n" % (request.key, error.code))
        return 1


if __name__ == "__main__":
    sys.exit(main())
