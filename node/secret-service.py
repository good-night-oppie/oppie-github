"""Native-worker-only keyring bridge. Never log inputs, key material or GLib errors."""
import base64
import fcntl
import hashlib
import json
import os
import re
import stat
import sys


class Failure(Exception):
    def __init__(self, code):
        self.code = code


def fail(code):
    raise Failure(code)


def main():
    request = json.loads(sys.stdin.read(4097))
    if not isinstance(request, dict) or set(request) != {"operation", "namespace"}:
        fail("INVALID_REQUEST")
    namespace, operation = request["namespace"], request["operation"]
    if not isinstance(namespace, str) or not re.fullmatch(r"oppie-github-v1|oppie-github-test-[a-f0-9]{8,64}", namespace):
        fail("INVALID_REQUEST")
    if operation not in ("get", "get-or-create", "delete-test"):
        fail("INVALID_REQUEST")
    if operation == "delete-test" and not namespace.startswith("oppie-github-test-"):
        fail("INVALID_REQUEST")

    runtime = "/run/user/" + str(os.getuid())
    runtime_stat = os.lstat(runtime)
    if not stat.S_ISDIR(runtime_stat.st_mode) or runtime_stat.st_uid != os.getuid() or runtime_stat.st_mode & 0o077:
        fail("KEYRING_MISSING")
    bus = runtime + "/bus"
    bus_stat = os.lstat(bus)
    if not stat.S_ISSOCK(bus_stat.st_mode) or bus_stat.st_uid != os.getuid():
        fail("KEYRING_MISSING")
    # Use only the caller's existing session bus; do not autolaunch or borrow another user.
    os.environ["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=" + bus
    lock_path = runtime + "/oppie-github-key-" + hashlib.sha256(namespace.encode()).hexdigest() + ".lock"
    lock = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock, "rb", closefd=True) as guard:
        ls = os.fstat(guard.fileno())
        if ls.st_uid != os.getuid() or not stat.S_ISREG(ls.st_mode) or ls.st_nlink != 1 or ls.st_mode & 0o077:
            fail("KEYRING_MISSING")
        try:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("KEYRING_BUSY")

        import gi
        gi.require_version("Secret", "1")
        from gi.repository import Gio, GLib, Secret
        service = Secret.Service.get_sync(Secret.ServiceFlags.OPEN_SESSION, None)
        collection = Secret.Collection.for_alias_sync(service, "default", Secret.CollectionFlags.NONE, None)
        if collection is None:
            fail("KEYRING_MISSING")
        if collection.get_locked():
            fail("KEYRING_LOCKED")
        schema_name = "org.oppie.GitHubPlugin.MasterKey"
        schema = Secret.Schema.new(schema_name, Secret.SchemaFlags.NONE, {"application": Secret.SchemaAttributeType.STRING, "namespace": Secret.SchemaAttributeType.STRING})
        attrs = {"application": "oppie-github", "namespace": namespace}
        items = collection.search_sync(schema, attrs, Secret.SearchFlags.ALL, None)
        if len(items) > 1:
            fail("KEYRING_AMBIGUOUS")
        if items and items[0].get_locked():
            fail("KEYRING_LOCKED")
        connection = service.get_connection()
        if operation == "delete-test":
            for item in items:
                result = connection.call_sync("org.freedesktop.secrets", item.get_object_path(), "org.freedesktop.Secret.Item", "Delete", None, GLib.VariantType.new("(o)"), Gio.DBusCallFlags.NONE, 5000, None)
                if result.unpack()[0] != "/":
                    fail("KEYRING_PROMPT_REQUIRED")
            return {"ok": True, "deleted": bool(items)}
        if items:
            items[0].load_secret_sync(None)  # No unlock request or UNLOCK search flag.
            value = items[0].get_secret()
            if value is None:
                fail("KEYRING_LOCKED")
            key = value.get_text()
            if not isinstance(key, str) or len(base64.b64decode(key, validate=True)) != 32:
                fail("SECURE_STORAGE_UNAVAILABLE")
            return {"ok": True, "key": key}
        if operation == "get":
            fail("KEYRING_KEY_MISSING")

        key = base64.b64encode(os.urandom(32)).decode("ascii")
        secret = service.encode_dbus_secret(Secret.Value.new(key, -1, "text/plain"))
        properties = {"org.freedesktop.Secret.Item.Label": GLib.Variant("s", "Oppie GitHub plugin encryption key"), "org.freedesktop.Secret.Item.Attributes": GLib.Variant("a{ss}", dict(attrs, **{"xdg:schema": schema_name}))}
        # Direct D-Bus call deliberately does not run a returned Prompt. A locked
        # collection or provider consent request fails closed without showing UI.
        result = connection.call_sync("org.freedesktop.secrets", collection.get_object_path(), "org.freedesktop.Secret.Collection", "CreateItem", GLib.Variant("(a{sv}(oayays)b)", (properties, secret.unpack(), False)), GLib.VariantType.new("(oo)"), Gio.DBusCallFlags.NONE, 5000, None)
        item_path, prompt = result.unpack()
        if prompt != "/" or item_path == "/":
            fail("KEYRING_PROMPT_REQUIRED")
        return {"ok": True, "key": key}


if __name__ == "__main__":
    try:
        result = main()
    except Failure as exc:
        result = {"ok": False, "errorCode": exc.code}
    except Exception:
        result = {"ok": False, "errorCode": "SECURE_STORAGE_UNAVAILABLE"}
    sys.stdout.write(json.dumps(result, separators=(",", ":")))
    sys.stdout.flush()
    sys.exit(0 if result.get("ok") else 1)
