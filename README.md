# Secret Santa

A small website for the Christmas Eve party Secret Santa ($20 limit).

- **Sign-up page:** people write their name, type their email twice, and tap "Put my name in." They get a confirmation email right away.
- **Admin page** (add `#admin` to the end of the address): enter the admin password, which gets emailed to you during setup, to see who's in, remove people, close sign-ups, draw names, and resend emails.
- **The draw** shuffles everyone into one big loop (A gives to B, B gives to C, and the last person gives to A). Nobody gets themselves, and nobody ends up just swapping with one other person. The matches stay on the server and in each person's email. The admin page never shows them.

It comes in two pieces, both free:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| `web/` | GitHub Pages | The two pages. Every push to `main` rebuilds and republishes them (`.github/workflows/deploy.yml`). |
| `apps-script/Code.gs` | Google Apps Script, under your Google account | Saves sign-ups, draws names, and sends the emails from your Gmail. |

## Set up the backend (one time, about 5 minutes)

1. Go to https://script.google.com and click **New project**. Click "Untitled project" at the top and name it **Secret Santa**.
2. Delete what's in `Code.gs`, paste in everything from `apps-script/Code.gs`, and click **Save**. The admin password gets emailed to your Google account. To send it somewhere else, set `ORGANIZER_EMAIL` near the top first.
3. Pick **setup** in the menu next to **Run**, then click **Run**. Google asks you to authorize it. If you see "Google hasn't verified this app," click **Advanced**, then **Go to Secret Santa (unsafe)**. That warning shows up for any script you write yourself. Click **Allow**: it needs permission to send email as you. The script then emails you the admin password.
4. Click **Deploy** > **New deployment**. Click the gear next to "Select type" and choose **Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone**, then click **Deploy**.
5. Copy the **Web app URL**. It ends in `/exec`. Paste it into `web/src/config.js` and push. The site rebuilds with it in a minute or two.

To change the admin password later, edit `ADMIN_PASSWORD` under **Project Settings** > **Script properties**.

To check the backend, open the Web app URL in a browser. You should see a line of text that starts with `{"ok":true`.

## Changing things later

- **Party details or email wording:** edit `apps-script/Code.gs` (party details are at the top, email wording is under "Emails"). Paste it into the Apps Script editor again, then click **Deploy** > **Manage deployments** > the pencil > **Version: New version** > **Deploy**. The URL stays the same.
- **The website:** edit files in `web/` and push to `main`.

## Good to know

- Emails come from the Google account that deployed the script, with "Secret Santa" as the sender's name.
- Apps Script can email 100 people a day from a regular Gmail account. The draw emails everyone at once, so sign-ups stop at 90, and the draw waits until tomorrow if today's limit can't cover everyone. The admin page tells you when that happens.
- Close sign-ups first, then draw names. The draw only happens once.
- **Test run:** sign up 3 test people with Gmail "+" addresses (like `yourname+1@gmail.com`, `yourname+2@gmail.com`), which all land in your inbox. Close sign-ups, draw names, and check the emails. Then, in the Apps Script editor, pick **startOver** next to **Run** and click **Run**. That wipes the sign-ups, the draw, and the matches, and opens sign-ups again. The admin password stays the same. There's no undo.
- You can remove people until names are drawn.
- Mistyped email addresses usually don't fail right away. Gmail sends a "couldn't be delivered" notice to your inbox instead. Since everyone gets a confirmation email when they sign up, those notices show up before the draw, while it's still easy to fix: remove the person and have them sign up again.
- The matches are saved in the script's Script properties as `match:` entries, using ID numbers instead of names. Skip those if you want to be surprised too.
- After 20 wrong admin passwords, the admin page locks for 10 minutes.

## Working on it

- `cd apps-script && npm test`: tests for `Code.gs`, run in Node with stand-ins for Google's services
- `cd web && npm install && npm run dev`: runs the site on your computer, using the backend in `config.js`
- `cd web && npm run build:demo`: makes `web/dist-demo/index.html`, a single-file demo with a fake backend and made-up people

## Not built yet

- Adding someone after names are drawn, or handling someone who drops out
- Fixing someone's email after the draw
