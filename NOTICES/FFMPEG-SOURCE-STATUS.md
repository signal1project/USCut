# FFmpeg provenance and source-distribution status

The local binary identifies itself as n9.0.1-30-g9258bacca5-20260915.
Its exact executable/DLL hashes and configure flags are recorded in
MANIFEST.json and FFMPEG-BUILD.txt. GPL and nonfree flags are not enabled.

Upstream build project: https://github.com/BtbN/FFmpeg-Builds
Matching-version release candidate:
https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-15-13-18
Asset name: ffmpeg-n9.0.1-30-g9258bacca5-win64-lgpl-shared-9.0.zip
This identifies a candidate upstream asset; matching the version string alone
is not verification of archive provenance. Local file hashes are recorded.

RELEASE REQUIREMENT STILL OPEN: retain and make available complete corresponding
source for the distributed FFmpeg build and covered linked components, including
applicable patches and build scripts. Verify the upstream archive/checksum,
build recipe revision and dependency source revisions. Publish the source
package with the installer and document its actual URL and retrieval method.
No source package has yet been assembled or published by this correction.
A link to a general upstream repository is not represented as satisfying this.

The full GPLv3 and LGPLv3 texts are supplied in this NOTICES directory.
The FFmpeg DLLs include many third-party components; the npm notice inventory
alone does not cover all of their attribution/source obligations.

Codec patents are separate from copyright-license compliance. The LGPL switch
and Windows encoder do not establish H.264/AAC patent clearance. OpenH264 is
also enabled in this build; any reliance on Cisco patent coverage must be
checked against its binary-distribution conditions. No licenses were purchased
and no assurance of patent coverage is made here.

References:
https://ffmpeg.org/legal.html
https://www.openh264.org/faq.html
