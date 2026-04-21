## Plan: Add Custom Icon to Whisper Desktop

Replace the default Vite icon with a custom icon for both the browser tab and the Electron app (window, taskbar, and Windows installer).

### Phase 1 — Create Icon Assets
1. Design or source a 1024×1024 PNG master image (your logo/icon)
2. Export the following files from the master:
   - `icon.svg` — vector version if possible (for browser tab)
   - `icon.png` — 256×256 PNG (for Electron BrowserWindow)
   - `icon.ico` — multi-resolution Windows icon with sizes: 16, 32, 48, 256px
     - Use a tool like https://www.icoconverter.com/ or ImageMagick: `magick icon.png -define icon:auto-resize=256,48,32,16 icon.ico`
3. Place all three files in `public/`

### Phase 2 — Wire Up Browser Tab Icon
4. Edit `index.html` line 5 — replace `/vite.svg` with your icon:
   ```html
   <link rel="icon" type="image/svg+xml" href="/icon.svg" />
   ```
   Or if using `.ico`:
   ```html
   <link rel="icon" href="/icon.ico" />
   ```
5. Delete `public/vite.svg` (no longer needed)

### Phase 3 — Wire Up Electron Window Icon
6. Edit `electron/main.cjs` — add `icon` to `BrowserWindow` options:
   ```js
   const win = new BrowserWindow({
       width: 1200,
       height: 800,
       icon: path.join(__dirname, '../public/icon.png'),
       webPreferences: { contextIsolation: true },
       title: 'Whisper Desktop',
   });
   ```

### Phase 4 — Wire Up Electron Builder (installer/exe icon)
7. Edit `package.json` — add a `"build"` config section (if not present):
   ```json
   "build": {
     "appId": "com.yourname.whisperdesktop",
     "win": {
       "icon": "public/icon.ico"
     }
   }
   ```

### Relevant Files
- `public/` — where icon files go
- `index.html` — browser tab icon (line 5)
- `electron/main.cjs` — Electron window icon (BrowserWindow options)
- `package.json` — electron-builder icon for the .exe/installer

### Verification
1. Run `npm run dev` → check browser tab shows new icon
2. Run `npm run electron:dev` → check Electron window title bar and taskbar show new icon
3. Run `npm run electron:build` → check the generated `.exe` and installer use the new icon

### Decisions
- Use `.ico` for the Windows exe (required by electron-builder)
- Use `.svg` or `.ico` for the browser tab (SVG preferred for crispness)
- PNG is fine for the live Electron window icon (not the installer)
