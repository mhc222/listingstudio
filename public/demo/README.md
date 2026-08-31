# Landing page before/after demo images

The public homepage slider (`app/landing-showcase.tsx`) loads two static files from here:

- `before.jpg` — the original, unedited listing photo
- `after.jpg` — the Listing Studio output of that same photo

Requirements:
- Same subject/framing so the drag comparison lines up (ideally the exact original + its edited output).
- Same aspect ratio (both are `object-cover` in a 3:2 frame; matched dimensions look best).
- Real listing photos — the whole point is honest proof. A staged/enhanced pair from a real job is ideal.

Until both files exist the slider shows labeled "Before photo / After photo" placeholder tiles (no broken images).
Drop the two files in and reload — no code change needed.
