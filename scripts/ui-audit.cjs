const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.AUDIT_URL || "http://127.0.0.1:5173";
const email = process.env.AUDIT_ADMIN_EMAIL;
const password = process.env.AUDIT_ADMIN_PASSWORD;
const output = path.resolve(__dirname, "..", "test-results", "ui-audit");
if (!email || !password) throw new Error("AUDIT_ADMIN_EMAIL and AUDIT_ADMIN_PASSWORD are required");
fs.mkdirSync(output, { recursive: true });

async function settle(ms = 900) { await new Promise(resolve => setTimeout(resolve, ms)); }
async function capture(win, name) { const image = await win.webContents.capturePage(); fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG()); }
async function waitForHeading(win, expected, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await win.webContents.executeJavaScript(`({heading: document.querySelector('h1')?.textContent || '', loading: document.body.textContent.includes('Opening Swapnapurti Library')})`);
    if (state.heading.includes(expected) && !state.loading) return;
    await settle(200);
  }
  throw new Error(`Expected heading "${expected}" at ${win.webContents.getURL()}`);
}
async function navigate(win, route, heading) {
  await win.webContents.executeJavaScript(`history.pushState({}, '', ${JSON.stringify(`/${route}`)}); dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForHeading(win, heading);
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const loading = await win.webContents.executeJavaScript(`document.body.textContent.includes('Loading live records')`);
    if (!loading) break;
    await settle(150);
  }
  await settle(300);
}

app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on("console-message", (_event, level, message) => { if (level >= 2) errors.push(message); });
  await win.loadURL(baseUrl);
  const loginResult = await win.webContents.executeJavaScript(`fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(${JSON.stringify({ email, password })})}).then(async r=>({status:r.status,body:await r.json()}))`);
  if (loginResult.status !== 200) throw new Error(`Audit login failed: ${JSON.stringify(loginResult.body)}`);
  await win.loadURL(baseUrl);
  await waitForHeading(win, "Administrator");
  await capture(win, "dashboard-desktop");
  const routes={members:"Members",plans:"Membership Plans",subscriptions:"Subscriptions",seats:"Study Rooms & Seats",shifts:"Study Shifts",attendance:"Attendance",books:"Book Catalog",loans:"Book Issue & Return",reservations:"Book Reservations",fines:"Fines & Charges",payments:"Payments & Receipts",expenses:"Expenses",notifications:"Notifications",reports:"Reports & Analytics",settings:"Settings",audit:"Audit Logs",backup:"Backup & Recovery"};
  for(const [route, heading] of Object.entries(routes)){await navigate(win,route,heading);await capture(win,`${route}-desktop`)}
  await navigate(win,"members","Members");
  win.setSize(1024, 768); await settle(); await capture(win, "members-tablet");
  win.setSize(390, 844); await settle(); await capture(win, "members-mobile");
  const layout = await win.webContents.executeJavaScript(`({viewport:innerWidth,body:document.body.scrollWidth,html:document.documentElement.scrollWidth,title:document.title,heading:document.querySelector('h1')?.textContent||''})`);
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ layout, consoleErrors: errors }, null, 2));
  await win.webContents.session.clearStorageData();
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
