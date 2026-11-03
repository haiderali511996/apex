"""Run the Google OAuth 2.0 authorization-code flow and print the authorization URL.

Requires: pip install google-auth-oauthlib google-auth-httplib2

Credentials are read from environment variables (never hardcode secrets):
    GOOGLE_CLIENT_ID, GOOGLE_PROJECT_ID, GOOGLE_CLIENT_SECRET
Optional:
    GOOGLE_REDIRECT_URI  (default http://localhost:8080/)
    GOOGLE_SCOPES        (space-separated, default: openid email profile)

Usage:
    python auth_script.py
Open the printed URL, approve access, then paste the full URL you were
redirected to (or just the `code` value) back into the prompt.

On success the refresh token is written to GOOGLE_REFRESH_TOKEN in .env.local
(next to this script), replacing any existing value.
"""

import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import google_auth_httplib2
import httplib2
from google_auth_oauthlib.flow import Flow


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Missing required environment variable: {name}")
    return value


def save_env_value(path: Path, key: str, value: str) -> None:
    """Set key=value in a dotenv file, replacing an existing entry or appending one."""
    lines = path.read_text().splitlines() if path.exists() else []
    entry = f"{key}={value}"
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = entry
            break
    else:
        lines.append(entry)

    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".env.local.")
    try:
        with os.fdopen(fd, "w") as f:
            f.write("\n".join(lines) + "\n")
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def main() -> None:
    client_id = require_env("GOOGLE_CLIENT_ID")
    project_id = require_env("GOOGLE_PROJECT_ID")
    client_secret = require_env("GOOGLE_CLIENT_SECRET")
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8080/")
    scopes = os.environ.get("GOOGLE_SCOPES", "openid email profile").split()

    client_config = {
        "web": {
            "client_id": client_id,
            "project_id": project_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "redirect_uris": [redirect_uri],
        }
    }

    flow = Flow.from_client_config(client_config, scopes=scopes, redirect_uri=redirect_uri)
    auth_url, _state = flow.authorization_url(access_type="offline", prompt="consent")

    print("Open this URL in your browser to authorize access:\n")
    print(auth_url)
    print()

    response = input("Paste the redirected URL (or the code) here: ").strip()
    if not response:
        return
    if response.startswith("http"):
        code = parse_qs(urlparse(response).query).get("code", [""])[0]
    else:
        code = response
    if not code:
        sys.exit("No authorization code found.")

    flow.fetch_token(code=code)
    creds = flow.credentials

    # Confirm the credentials work through the httplib2 transport.
    http = google_auth_httplib2.AuthorizedHttp(creds, http=httplib2.Http())
    resp, content = http.request("https://openidconnect.googleapis.com/v1/userinfo")
    print(f"Userinfo status: {resp.status}")
    print(content.decode())
    if not creds.refresh_token:
        sys.exit("No refresh token returned.")

    env_path = Path(__file__).resolve().parent / ".env.local"
    save_env_value(env_path, "GOOGLE_REFRESH_TOKEN", creds.refresh_token)
    print(f"Refresh token saved to {env_path} as GOOGLE_REFRESH_TOKEN.")


if __name__ == "__main__":
    main()
