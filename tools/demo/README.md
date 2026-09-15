# Video manual recorder

Records the tutorial videos for the dashboard's **Guide → Using the
dashboard** manual, by driving the real application in a real browser. It is
a development tool and is never shipped to the client's PC.

## Running it

    npm install
    npx playwright install chromium
    npm run record                 # all chapters
    npm run record -- 04-control   # just one

Videos land in `out/`. Copy them to
`i2ie-webapp/my-app/public/videos/` for the manual to play them.

## What it does for each chapter

1. **Reseeds** a separate `demo-data/demo.sqlite` — never a real database
2. Starts a **mock worker** on 3901 so the modem reads as healthy
3. Starts the dashboard on **3456** pointed at that database
4. Drives the browser with captions, a drawn cursor and highlights
5. Writes `out/<chapter>.webm`

## Why a mock worker

With no worker running, the Topbar shows a red "Worker offline" chip and the
Modem page is a wall of red. A tutorial that opens on a broken-looking
system teaches the wrong thing — an operator needs to learn what NORMAL
looks like so they can recognise abnormal.

It answers the real worker's endpoints with the bench SIM7600G-H's actual
identity. No serial port is opened and no SMS is sent.

**Chapter 7 is the exception.** It is *about* failure, so it is recorded
against `worker: "failing"` — a port with nothing on it — and the failure
and skip behaviour you see is genuine, not staged.

## Why it reseeds between every chapter

Without it, chapter 7's failed and skipped commands would still be sitting
in the queue and the alerts list while chapter 8 was recorded, so a video
about the Logs screen would open on errors that have nothing to do with it.

The reseed clears TABLES rather than deleting the file: the dashboard holds
the database open, and Windows refuses to unlink a file with an open handle.

## Notes

- Output is **VP8 WebM**. Playwright's bundled ffmpeg has no H.264 encoder,
  so mp4 needs a real ffmpeg installed. Every browser plays WebM, so the
  in-app manual does not need it.
- `narrator.ts` draws the cursor, because Playwright's video does not record
  the real pointer — without it the page appears to change by itself.
- Captions are English. The manual's WRITTEN steps are bilingual, so an
  Arabic operator has complete instructions even though the footage is not
  re-recorded.
