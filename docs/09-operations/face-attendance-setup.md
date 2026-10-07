# Face attendance — setting it up

A member walks up to the phone at reception, the screen recognises them, and their visit is
marked. The rules behind it are ADR-107, which also carries the measurements everything here
rests on.

Three things have to be true: the engine is running, members are enrolled, and the phone is
paired. In that order, because each needs the one before it.

## 1. The engine — a third container on Coolify

`apps/face` is a small Python service that turns a photograph into 128 numbers. It holds no
database, keeps nothing, and never learns a member's name.

| Setting | Value |
|---|---|
| Source | the same repository and `main` branch as web and worker |
| Build pack | **Dockerfile** |
| Dockerfile location | `Dockerfile.face` |
| Port | `8000` |
| **Domain** | **leave it empty** |

**The empty domain is the important line.** This service is given members' faces. A public
address would make it a face search engine for anybody who found it. It is reached only by
the web app, over Coolify's internal network, at `http://<service-name>:8000`.

Environment variables on the **face** service:

| Variable | Value |
|---|---|
| `FACE_SERVICE_TOKEN` | any long random string — the same one the web app gets |

Environment variables to add to the **web** service:

| Variable | Value |
|---|---|
| `FACE_SERVICE_URL` | `http://<the face service's name>:8000` |
| `FACE_SERVICE_TOKEN` | the same string |

A good token: `openssl rand -base64 36`.

The first build takes a few minutes — it installs OpenCV and downloads 39 MB of model
weights into the image. **The weights are checksummed and the build fails if they are not
byte-for-byte the ones the POC measured.** That is deliberate: the URLs point at a branch,
and a newer model would quietly stop matching every template already in the database, with
nothing failing loudly. If that check ever fires, somebody re-runs the POC before the engine
changes.

Check it afterwards from the web container, or from the Coolify terminal on the face service:

```
curl -s http://127.0.0.1:8000/health
{"ok":true,"modelVersion":"yunet-2023mar+sface-2021dec","embeddingSize":128}
```

`"ok": false` means the weights did not load, and the container says so rather than
answering requests it cannot serve.

## 2. Enrol the members

A member who signs up **from now on is enrolled as their selfie is accepted** — the gate
measures the photograph, refuses it if it will not work, and writes the template from the
same embedding. Nothing to run.

Everybody who signed up before that existed needs one pass:

```
pnpm --filter @mfp/worker run enrol:faces          # says what it would do
pnpm --filter @mfp/worker run enrol:faces -- --yes
```

It needs `FACE_SERVICE_URL`, `FACE_SERVICE_TOKEN` and `APP_URL` in the environment.

**It refuses more often than it enrols, and that is the point.** A selfie whose face is too
small produces a template that will never match at the desk — measured at 0.42 against
itself, below where two *different* members score — and enrolling it anyway would look like
success and fail silently every day afterwards. Each refusal names what the member has to
do, so the desk can ask them for a new photograph:

```
Harsh Bisht             would     284px
harshitbahuguna         refused   43px   TOO_FAR — photo taken from too far away
himani rawat            refused   310px  ANOTHER_FACE — somebody else is in the photo
Mohd Ayan               refused   300px  NO_CONSENT — did not agree to face attendance
```

## 3. Pair the phone

Max Register → **Settings → Attendance phone** → *Pair again*. It shows a six-digit code,
good for ten minutes. On the reception phone, open `https://maxfitnessgym.co.in/checkin` and
type the code. The phone keeps its token from then on, so this is done once.

The camera opens by itself. A member stands in front of it and is marked in; *Use my number
instead* is always one tap away, for somebody who never gave a photograph, who ticked no, or
who simply prefers it.

### Shadow mode

A newly paired phone starts in **shadow mode**: it records every visit but greets nobody by
name. Leave it there for the first fortnight. It is how the thresholds are confirmed against
real members in real light before anybody is greeted — and a wrong greeting is given in
front of two members at once.

Turn it off in Max Register → Settings → Attendance phone → *Let it greet members*.

## What this does not do

**There is no anti-spoofing.** A photograph held up to the camera would pass. No
permissively licensed liveness model was found, and this is written down rather than
designed around: what stands in its place is the frames-agree rule, the check-in cooldown, a
staffed reception desk, and the fact that the prize for spoofing is being marked present at
a gym. If it ever matters, it is a model swap behind the same seam.

**The thresholds are not final.** They come from thirteen members' selfies (ADR-107). A
bigger gallery has more chances of two members who look alike, which is what the runner-up
margin is for rather than the threshold. Shadow mode is where that gets checked.

## When something is wrong

| What the screen says | What it means |
|---|---|
| *Face check-in is not working right now* | the engine is down or unreachable — check `/health` on the face service |
| *Nobody has been set up for face check-in yet* | the gallery is empty — run `enrol:faces` |
| *Come a little closer* | the member's face is too small in the frame; the gate is working |
| *One person at a time, please* | two faces in the frame — the screen refuses rather than guessing |
| Pairing screen reappears | the token was revoked in Max Register; pair again |

Nothing on this list stops the gym: *Use my number instead* works throughout, and reception
can still mark anybody by hand from the Attendance screen.
