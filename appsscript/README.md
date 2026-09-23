# Apps Script deployment

The Apps Script project is the deployment target; this repo stays the source of
truth. `Code.js` and `Index.html` are generated copies of `AppsScript_WebApp.gs`
and `index.html` — gitignored here so they can't drift from the originals.

Local working copy: `~/Documents/Projects/pdf-to-csv-appsscript/`
Script editor: https://script.google.com/d/18GCmkkXN1KQU3ol18sLb445my1ukuD2w7bNnup0SdaXSXSAwr1MsMM2z/edit

## Shipping a change

    cd ~/Documents/Projects/pdf-to-csv-appsscript
    cp ../pdf-to-csv-converter/AppsScript_WebApp.gs Code.js
    cp ../pdf-to-csv-converter/index.html Index.html
    clasp push --force
    clasp create-deployment --description "what changed"

Re-pasting files into the editor by hand is what caused a stale version to be
run twice before; use the commands.

## Deployment settings

Held in `appsscript.json`, not clicked in the UI, so they survive a redeploy:
`executeAs: USER_DEPLOYING`, `access: DOMAIN`.

**USER_DEPLOYING (run as Karen) is deliberate and differs from the house
pattern's USER_ACCESSING.** The script writes to the usage-log Sheet and sends
alert mail. Running as the visitor would require every bookkeeper to have edit
access to that Sheet, and would send alerts from whoever hit the error. Running
as the owner avoids both, and the signed-in visitor is still identified
correctly because `Session.getActiveUser()` returns the email when the visitor
is in the same Workspace domain as the owner — which everyone here is.

`testSetup()` checks that assumption. If it reports identity is blank, switch
`executeAs` to `USER_ACCESSING`, push, redeploy, and grant Sheet access.
