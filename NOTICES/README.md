# USCut third-party notices

USCut's proprietary EULA is installed at `resources/LICENSE`. Third-party
components retain their own licenses; the EULA does not restrict those rights.

- `THIRD-PARTY.txt`: verbatim license, copyright and NOTICE files from the
  installed dependency tree, with original paths and SHA-256 hashes. This is
  a conservative superset including build tools, not a claim all entries ship.
- `MANIFEST.json`: upstream-file fingerprints, package-lock fingerprint and
  the exact shipped FFmpeg/FFprobe executable and DLL fingerprints.
- `APACHE-2.0.txt`: complete unmodified Apache License 2.0.
- `MIT.txt`: reference terms; individual copyright notices are in THIRD-PARTY.txt.
- `LGPL-3.0.txt` and `GPL-3.0.txt`: complete license texts for the LGPLv3
  FFmpeg build (LGPLv3 incorporates GPLv3 terms). Their inclusion does not
  license the proprietary USCut application under GPL.
- `FFMPEG-BUILD.txt`: actual binary version and full configure flags.
- `FFMPEG-SOURCE-STATUS.md`: source-distribution status and unresolved release work.

Installed FFmpeg files are at `resources/ffmpeg/`, not the source-tree
`resources/ffmpeg/win-x64/` path. Font license texts are at
`resources/assets/fonts/Montserrat-OFL.txt` and `PlayfairDisplay-OFL.txt`.
Electron's own license and Chromium notices are supplied alongside USCut.exe.
Whisper/whisper.cpp and native dependency legal files are included in
THIRD-PARTY.txt where present in the installed tree. Runtime-downloaded models
need their own version-specific licensing verification before release.

This collection is not a certification of complete redistribution compliance.
The exact native binaries, downloaded models and corresponding-source package
must also be reconciled before public distribution. Regenerate with
`node scripts/generate-third-party-notices.cjs` when dependencies change;
electron-builder also runs it before packaging.
