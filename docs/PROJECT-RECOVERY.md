# Project recovery

Each native project save is serialized behind previous saves for the same file. Writes use unique temporary files and retry transient Windows file locks. Before replacing a valid project, its previous version is saved as a `.json.bak` sibling. A corrupt primary file never replaces the valid backup.

Loading falls back to the previous valid version when the primary cannot be read. The renderer displays a recovery notice. The user should review and save the recovered project. This preserves one previous save, not an unlimited edit history. A backup contains project metadata and source references; it does not copy source media and cannot recover deleted footage.

Renderer save acknowledgments are matched to the current project and current content. An older completion cannot mark new edits as saved, change another project's save status, or overwrite the status of a newer save attempt. Failed IPC calls leave current edits dirty.

Verification: tests cover ten overlapping writes, previous-version retention, corrupt-primary recovery, corrupt-file preservation during the next save, absent recovery failure, edits during an in-flight save, project switching, out-of-order acknowledgments, and IPC failure. The Electron smoke additionally writes two project versions, corrupts the primary in its isolated profile, and verifies the real project-load handler returns the previous version with the recovery flag.
