#!/usr/bin/env python3
"""Build a driveable copy of index.html backed by an in-memory Firestore.

    python3 make-sandbox.py [out.html] [--seed roster]

The real page talks to the live `memorial-pe-tracker` project, so every
end-to-end test used to create real students in the database Zach grades from.
This swaps ONLY the Firebase ESM bootstrap block for a stub that keeps documents
in a plain object, so the whole app -- login, class pick, submit, undo, rename,
delete -- can be driven with zero production writes.

Nothing else in the page is touched: same markup, same CSS, same application
code, so what the sandbox does is what the site does.
"""
import re, sys, json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "index.html"

STUB = r"""<script>
// ---- SANDBOX: in-memory stand-in for Firestore. Not shipped. ----------------
(function () {
  const store = Object.create(null);           // "a/b/c" -> data object
  const seed = window.__SANDBOX_SEED || {};
  Object.keys(seed).forEach(k => { store[k] = JSON.parse(JSON.stringify(seed[k])); });
  window.__store = store;
  window.__writes = [];
  const log = (op, path) => window.__writes.push(op + " " + path);

  const path = (...p) => p.slice(1).join("/");
  const clone = o => JSON.parse(JSON.stringify(o));

  window.db = { __sandbox: true };
  window.auth = { currentUser: null };

  window.fbDoc = (...a) => ({ __doc: path(...a) });
  window.fbCollection = (...a) => ({ __coll: path(...a) });

  window.fbGetDoc = async ref => {
    const d = store[ref.__doc];
    return { id: ref.__doc.split("/").pop(), exists: () => d !== undefined,
             data: () => (d === undefined ? undefined : clone(d)) };
  };
  window.fbGetDocs = async ref => {
    const pre = ref.__coll + "/";
    const hits = Object.keys(store)
      .filter(k => k.startsWith(pre) && k.slice(pre.length).indexOf("/") < 0)
      .map(k => ({ id: k.slice(pre.length), data: () => clone(store[k]) }));
    return { forEach: cb => hits.forEach(cb), size: hits.length, docs: hits, empty: !hits.length };
  };
  window.fbSetDoc = async (ref, data, opts) => {
    log("set", ref.__doc);
    store[ref.__doc] = (opts && opts.merge && store[ref.__doc])
      ? Object.assign({}, store[ref.__doc], clone(data)) : clone(data);
  };
  window.fbUpdateDoc = async (ref, data) => {
    log("update", ref.__doc);
    if (!store[ref.__doc]) throw Object.assign(new Error("No document to update"), { code: "not-found" });
    store[ref.__doc] = Object.assign({}, store[ref.__doc], clone(data));
  };
  window.fbDeleteDoc = async ref => { log("delete", ref.__doc); delete store[ref.__doc]; };
  window.fbWriteBatch = () => {
    const ops = [];
    return {
      set:    (r, d) => (ops.push(() => window.fbSetDoc(r, d)), undefined),
      update: (r, d) => (ops.push(() => window.fbUpdateDoc(r, d)), undefined),
      delete: r      => (ops.push(() => window.fbDeleteDoc(r)), undefined),
      commit: async () => { for (const op of ops) await op(); }
    };
  };
  window.fbSignIn = async (auth, email) => {
    auth.currentUser = { email }; return { user: auth.currentUser };
  };
  window.fbUpdatePassword = async () => {};
})();
</script>"""

BOOT = re.compile(
    r'<script type="module">\s*\n\s*import \{ initializeApp \}.*?</script>', re.S)


def roster():
    """A class of eight with every status a dashboard can show, plus history."""
    today = "__TODAY__"
    docs = {
        "classes/c1": {"name": "1st Hour", "sortOrder": 1, "frozen": False},
        "classes/c3": {"name": "3rd Hour", "sortOrder": 2, "frozen": False},
        "classes/c7": {"name": "7th Hour", "sortOrder": 3, "frozen": False},
        "classes/cz": {"name": "2nd Period", "sortOrder": 9, "frozen": True},
        "settings/learningTarget": {"text": "Full range of motion on every rep.",
                                    "updatedAt": today},
    }
    # name, class, logCount, today score/done, submitted?
    people = [
        ("zora Alvarez",     "c1", 42, 6, 6, True),
        ("Adam  Bell",       "c1", 17, 3, 3, False),
        ("mary-jo Chen",     "c1",  0, 0, 0, False),
        ("Élodie Dupont",    "c3", 31, 6, 7, True),
        ("Bob Ash",          "c3",  9, 4, 5, True),     # submitted but below 6
        ("Student 10",       "c3",  5, 0, 0, False),
        ("Student 2",        "c7", 88, 2, 2, False),
        ("de Vries, Kees",   None,  3, 0, 0, False),    # unassigned
    ]
    for i, (name, cls, count, score, done, sent) in enumerate(people):
        addr = "addr%02d" % i
        d = {"name": name, "routines": [], "logCount": count,
             "lastLogDate": today if count else "",
             "todayDate": today if done else "", "todayDay": "A" if i % 2 else "B",
             "todayScore": score, "todayDone": done}
        if cls: d["classId"] = cls
        if sent: d["submission"] = {"date": today, "day": "A", "subId": "s1"}
        docs["students/" + addr] = d
        for r in range(min(count, 3)):
            docs["students/%s/history/L%d" % (addr, r)] = {
                "date": today, "exercise": "Bodyweight Push-Ups", "component": "upper",
                "sets": 3, "reps": 10, "lbs": 0, "day": "A", "subId": "s1"}
    return docs


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") \
          else HERE / "sandbox.html"
    html = SRC.read_text(encoding="utf-8")
    if not BOOT.search(html):
        sys.exit("Firebase bootstrap block not found — has index.html changed shape?")
    # Emitted as a plain object literal, so "__TODAY__" can become the bare
    # identifier __t -- the seed then dates itself on whatever day it is run.
    seed = json.dumps(roster(), indent=1).replace('"__TODAY__"', '__t')
    boot = ('<script>\nvar __t = (function (d) { return d.getFullYear() + "-"'
            ' + String(d.getMonth() + 1).padStart(2, "0") + "-"'
            ' + String(d.getDate()).padStart(2, "0"); })(new Date());\n'
            'window.__SANDBOX_SEED = ' + seed + ';\n</script>')
    html = BOOT.sub(lambda m: boot + "\n" + STUB, html, count=1)
    out.write_text(html, encoding="utf-8")
    print("wrote", out, "(", len(html), "chars )")


if __name__ == "__main__":
    main()
