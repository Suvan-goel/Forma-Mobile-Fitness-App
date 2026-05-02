#!/usr/bin/env python3

import argparse
import html
import http.cookiejar
import json
import os
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode, urljoin
import urllib.request


SHARE_URL = (
    "https://shanghaitecheducn-my.sharepoint.com/:f:/g/personal/"
    "dongsx_shanghaitech_edu_cn/EqveZdlGsPxPrfBLQcO_IrgBs6bz7KX1zGGSz_GtLDIfAg"
)
FOLDER_PATH = "RepCount%5Bcvpr2022%5D"
ARCHIVE_NAME = "RepCountA.tar.gz"
TREE_NAME = "RepCountA_file_tree.txt"
DEFAULT_PASSWORD = "repcount"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
)


class SharePointPasswordFormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.form_action = None
        self.inputs = {}

    def handle_starttag(self, tag, attrs):
        attr_map = dict(attrs)
        if tag == "form" and attr_map.get("id") == "inputForm":
            self.form_action = html.unescape(attr_map.get("action", ""))
            return
        if tag != "input":
            return
        name = attr_map.get("name")
        if not name:
            return
        self.inputs[name] = html.unescape(attr_map.get("value", ""))


def request(opener, url, data=None):
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers)
    with opener.open(req, timeout=60) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace"), response.geturl()


def get_authenticated_folder_page(password):
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

    password_page, page_url = request(opener, SHARE_URL)
    parser = SharePointPasswordFormParser()
    parser.feed(password_page)
    if not parser.form_action:
        if "driveInfo" in password_page:
            return opener, password_page
        raise RuntimeError("Could not find the SharePoint password form.")

    fields = {
        name: value
        for name, value in parser.inputs.items()
        if name.startswith("__") or name == "SideBySideToken"
    }
    fields["txtPassword"] = password
    fields["btnSubmitPassword"] = parser.inputs.get("btnSubmitPassword", "验证")

    post_url = urljoin(page_url, parser.form_action)
    form_data = urlencode(fields).encode("utf-8")
    folder_page, _ = request(opener, post_url, data=form_data)
    if "driveInfo" not in folder_page:
        raise RuntimeError("SharePoint did not return folder metadata. Check the password.")
    return opener, folder_page


def parse_drive_info(folder_page):
    match = re.search(r'"driveInfo":(\{.*?\}),"vanityUrls"', folder_page, re.DOTALL)
    if not match:
        raise RuntimeError("Could not find driveInfo in the SharePoint page.")
    return json.loads(match.group(1))


def fetch_folder_items(opener, drive_info):
    drive_url = drive_info[".driveUrl"]
    token = drive_info[".driveAccessToken"]
    api_url = f"{drive_url}/root:/{FOLDER_PATH}:/children?{token}"
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    req = urllib.request.Request(api_url, headers=headers)
    with opener.open(req, timeout=60) as response:
        data = json.load(response)
    return {item["name"]: item for item in data.get("value", [])}


def download_small_file(url, output_path):
    headers = {"User-Agent": USER_AGENT}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as response:
        output_path.write_bytes(response.read())


def existing_file_is_probably_error(path):
    if not path.exists() or path.stat().st_size == 0:
        return False
    with path.open("rb") as handle:
        prefix = handle.read(2)
    return prefix != b"\x1f\x8b" and path.stat().st_size < 10 * 1024 * 1024


def run_curl(url, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if existing_file_is_probably_error(output_path):
        print(f"Removing stale non-gzip response: {output_path}")
        output_path.unlink()

    cmd = [
        "curl",
        "-L",
        "-C",
        "-",
        "--fail",
        "--retry",
        "20",
        "--retry-delay",
        "10",
        "--retry-all-errors",
        "-o",
        str(output_path),
        url,
    ]
    return subprocess.run(cmd).returncode


def main():
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Download the RepCountA dataset from SharePoint.")
    parser.add_argument(
        "--output-dir",
        default=str(repo_root / "datasets" / "RepCount"),
        help="Directory for RepCountA.tar.gz and RepCountA_file_tree.txt.",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("REPCOUNT_PASSWORD", DEFAULT_PASSWORD),
        help="SharePoint link password. Defaults to repcount.",
    )
    parser.add_argument(
        "--url-only",
        action="store_true",
        help="Print the temporary direct archive URL instead of downloading.",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir).expanduser().resolve()
    archive_path = output_dir / ARCHIVE_NAME
    tree_path = output_dir / TREE_NAME

    print("Redeeming SharePoint password...")
    opener, folder_page = get_authenticated_folder_page(args.password)
    drive_info = parse_drive_info(folder_page)

    print("Fetching RepCount folder metadata...")
    items = fetch_folder_items(opener, drive_info)
    archive = items.get(ARCHIVE_NAME)
    tree = items.get(TREE_NAME)
    if not archive or "@content.downloadUrl" not in archive:
        raise RuntimeError(f"Could not find {ARCHIVE_NAME} in the SharePoint folder.")

    output_dir.mkdir(parents=True, exist_ok=True)
    if tree and "@content.downloadUrl" in tree:
        download_small_file(tree["@content.downloadUrl"], tree_path)
        print(f"Wrote {tree_path}")

    archive_url = archive["@content.downloadUrl"]
    expected_size = archive.get("size")
    if args.url_only:
        print(archive_url)
        return 0

    if expected_size:
        print(f"Expected archive size: {expected_size:,} bytes")
    print(f"Downloading to {archive_path}")
    code = run_curl(archive_url, archive_path)
    if code != 0:
        return code

    actual_size = archive_path.stat().st_size
    print(f"Downloaded size: {actual_size:,} bytes")
    if expected_size and actual_size != expected_size:
        print("Download size does not match the SharePoint metadata; run this script again to resume.")
        return 1
    print("RepCountA.tar.gz download complete.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
