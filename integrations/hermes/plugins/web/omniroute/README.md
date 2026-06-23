# Hermes OmniRoute Web Plugin

Bundled Hermes web backend for this OmniRoute fork. It routes Hermes
`web_search` to OmniRoute `POST /v1/search` and Hermes `web_extract` to
OmniRoute `POST /v1/web/fetch`.

Install into a server Hermes checkout:

```bash
install -d /opt/apps/hermes/source/plugins/web/omniroute
cp integrations/hermes/plugins/web/omniroute/* /opt/apps/hermes/source/plugins/web/omniroute/
install -d /opt/apps/hermes/venv/lib/python3.12/site-packages/plugins/web/omniroute
cp integrations/hermes/plugins/web/omniroute/* /opt/apps/hermes/venv/lib/python3.12/site-packages/plugins/web/omniroute/
```

Hermes config:

```yaml
web:
  search_backend: omniroute
  extract_backend: omniroute
```

Environment:

```bash
OMNIROUTE_BASE_URL=http://127.0.0.1:20129
OMNIROUTE_API_KEY=...
```
