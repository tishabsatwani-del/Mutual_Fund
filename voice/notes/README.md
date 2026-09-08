# Voice notes (area 16 of the fourth audit)

The storm and emergency screens play a WhatsApp-style voice note from the
friend's MFD: two or three bubbles in Hindi/Hinglish, English captions timed
from the text, no skip, the next button unlocking at the last caption. The
captions and the unlock clock live in the page; the audio is looked up here:

    voice/notes/<key>.m4a   (then voice/notes/<key>.ogg)

Keys — one file per storm and per emergency, nine in all:

    covid  gfc  corr2022  oilwar2026  drawn      (the crash door)
    icu  business  pandemic  war                 (the emergency door)

Record each file to the script printed on its card (about 13–17 seconds; the
bubble timings are 4–5 seconds each with a 0.9-second gap, starting at 0.6 s).
Keep the nine files under 3 MB together. Until a file exists at the path, the
device voice reads the English captions on the same clock, and with sound off
the captions play alone — the unlock is caption-driven either way.

Nothing else needs to change: no rebuild, no code.
