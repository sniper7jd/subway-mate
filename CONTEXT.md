# Subway Mate handoff

This file is the project memory. Read it before changing the demo. The running app is a phone website for one station: Times Square–42 St. A friend can continue from the hardcoded walk that is on screen today, or turn the older station file and server back on.

## What it is

People get lost inside subway stations. Subway Mate is a phone website, not a native app. You hold the phone, see a short walk, hear the same words, and press a button when you are looking at the next sign. The destination is a place, such as the Bronx or Queens, not a train name. The app answers with the train, the platform, and step-by-step walking directions.

The hackathon demo is Times Square only. Judges open it in a browser. Profiles that were designed but are not on the current screen: tourist, low vision, deaf, and wheelchair. Wheelchair routing must not use stairs. That rule still lives in `shared/guidance.js`.

## How the idea changed

1. The first idea was an indoor wayfinding agent for a station, with a camera, voice, and a local station file so the model could not invent nodes, distances, or compass degrees.
2. It became a Vite and React site plus a small Express server. Grok (xAI) was used only when online, and only to phrase a route that the local file already knew. Offline, the trip lived in the browser.
3. Live arrivals were tried for one line of the active trip, from subwayinfo.nyc, with a three-minute stale limit. That is not on the demo path now.
4. On-device OCR (Tesseract) was tried so a sign photo never had to leave the phone. Webcam frames did not read reliably. A coarse color match against a handful of sign pictures was tried next. Pointing a camera at those pictures still failed often enough that the demo button no longer reads the image.
5. The pitch version is fully local and scripted. Two walks are hardcoded. The sign button advances the script. The map shows only the real walk, not a fake wrong turn. The older server, station graph, and sign matcher are still in the repo for later, and the screen does not call them.

Do not invent foot distances or surveyed compass bearings for a future real graph. The scripted demo does use the distances the demo script asked for (30 meters, 15 meters, and so on). Those numbers are demo copy, not a survey.

## What the judge sees now

1. Welcome screen: “Move through the subway with confidence.” Either button starts the same flow.
2. About a second of “Detecting current location.”
3. Spoken and written: “You entered the 42nd Street–Times Square station. Where do you want to go?”
4. Bronx or Queens (Flushing counts as Queens). Anything else, including One World Center, gets: “This demo only walks to the Bronx or Queens.”
5. The reply names the train and platform, then step 1. The arrow points the walk and shows the distance. North is up, east is right, west is left.
6. The map has three checkpoints. There is no “walk back” detour on the map.
7. “Read this sign” does not look at the camera. Each press completes the current step and speaks the next one. The last press says the train is on your left in about five minutes. End returns to the welcome screen.
8. The chat history scrolls. The speaker button repeats the latest mate line. Questions during a walk are answered from the current step: which train, which platform, where you are.

### Bronx, the 1 train

Train: 1 Train (Uptown & The Bronx). Platform 2, upper level.

1. Walk straight north 30 meters through the main turnstiles. Keep the station booth on your right.
2. Turn right. Walk 15 meters toward the red circular 1 signs. Main mezzanine corridor.
3. Turn left and head down the stairs. Handrail on the right. Platform is 20 steps down.
4. Go out. The train is on your left in about five minutes.

### Queens, the 7 train

Train: 7 Train (Queens-bound). Platform 5, deep lower level.

1. Walk straight west 50 meters down the transfer corridor. Purple signs. Flat floor.
2. Turn right and walk 25 meters further west.
3. Take the escalator down. Boarding on both sides.
4. Same arrival line.

Sign pictures still exist under `public/signs/` for a later real match. The button does not use them.

## How to run

```bash
npm install
npm run dev
```

Open https://localhost:5173. The certificate warning is from the local HTTPS plugin, which the phone camera needs. Accept it. `npm run dev` starts Vite on 5173 and the Express API on 8787. The current screen does not call the API. If port 8787 is already taken, that process exits and can take Vite down with it. Free the port, or run `npx vite` alone.

Phone on the same Wi-Fi: use the computer’s LAN address with https and port 5173, and accept the certificate. Do not use a public tunnel for the demo. iOS will not open the camera on plain HTTP except localhost.

`.env` is not in git. Copy `.env.example` to `.env` only if you turn the Grok server path back on, and put your own key there. Never commit that file.

## Where the code is

| Path | Role |
| --- | --- |
| `src/App.jsx` | Phone screen: welcome, location beat, chat, voice, map, arrow, sign button |
| `src/mockRoutes.js` | The two walks, destination matching, and step advance |
| `src/styles.css` | Dark phone layout. The camera video is pinned inside the top pane so it cannot resize the page |
| `src/matchSign.js` | Unused by the button. Coarse color match against the seven sign files |
| `public/signs/` | Sign stills. Two are the photos supplied for the demo. The others are drawn stand-ins |
| `shared/times-square.json` | Earlier station file: entrances, signs, trips, edges. Not used by the current screen |
| `shared/guidance.js` | Pathfinder, wheelchair stair rule, entrance guesses, arrival wording. Not used by the current screen |
| `server/index.js` | Express routes for manifest, transcribe, landmark, arrivals. Not used by the current screen |
| `src/ocr.js` | Tesseract helper from the earlier on-device scan. Not used by the current screen |

`src/main.tsx` mounts `src/App.jsx`. Stay on Vite 7. Do not switch this app to the Figma scaffold’s Vite 8 setup.

## Decisions that should stick

- Phone website. Not Expo, not a store app.
- One station for the demo: Times Square–42 St.
- Destination is a place. The file maps the place to a train, a platform, and a path.
- The model must not invent nodes, distances, or compass degrees. If Grok comes back, it may only rephrase a route the local file already produced.
- Camera and microphone are separate from screen and speech. The camera stream is video only so the mic stays free.
- Speech output uses `speechSynthesis` and should start inside the tap. Speech recognition is the browser API and is online-only.
- Wrong-way signs, if scanning returns, should not skip a step. A downtown sign on a Bronx walk means turn around and stay put.
- No live elevator-outage API, no GTFS protobuf, no NaviLens, no second station.
- Do not parse the MTA GTFS-Pathways zip. It collapses Times Square’s two 1/2/3 island platforms into one northbound and one southbound.
- Elevator wording, if step-free returns, comes from the station file: SE 42nd & 7th, and the Broadway plaza between 42nd and 43rd.
- Nearby shops were an entrance shortcut in the earlier file: McDonald’s at 42nd and 7th, Baskin-Robbins at the Broadway plaza. The current demo does not ask which entrance. It assumes the main 42nd Street and 7th Avenue entrance.
- Sign photos: one older Wikimedia credit is noted in `public/CREDITS.txt`. The demo stills are either supplied photos or generated stand-ins. Do not add Candy Chan drawings or Street View screenshots.

## What to build next

The screen is a script. The next real version would:

- Match the sign pictures again, or replace that with a model that only chooses from the known sign ids.
- Drive the walk from `shared/times-square.json` and `findPath` in `shared/guidance.js`, including a wheelchair path that skips stairs.
- Let the rider talk about the current step without leaving the local file.
- Show a wrong-way arrow only when a sign that is not on this walk is confirmed.
- Add One World Center as a third scripted walk if the demo needs it. It is not in `mockRoutes.js` today.
- Keep arrivals optional and never say the rider will miss a train. Name only the train they can catch.

## Checks

`npm run check` runs `shared/self-check.js` against the older station file. It does not cover the scripted screen. The scripted advance lives in `advanceStep` in `src/mockRoutes.js`.
