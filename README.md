# Kot Live

Beer counter, message board and photo drop for the kot TV.

## Install on your iPhone

1. Open this site's address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Kot Live** from your home screen, enter your name and the household code.

## What's in here

- `index.html`, `app.js`, `app.css`: the app (no build step, no tracking).
- `config.js`: the Supabase Project URL and publishable key. Both are safe to
  publish: every action still needs the household code, which is never stored here.
- Photos are shrunk on the phone to 800 px (longest side) before sending; this
  also removes location data from the photo.
