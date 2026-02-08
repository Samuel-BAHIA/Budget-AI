# Menu-test (Next.js)

## Fix for: `Error: Cannot find module './948.js'`
This error is almost always caused by a corrupted/stale Next.js build cache in `.next`.

The scripts in this repo now **auto-clean `.next`** before `dev` and `build`.

### Run
```bash
npm install
npm run dev
```

If you still see weird cache errors, also delete `node_modules` and reinstall:
```bash
rmdir /s /q node_modules .next  # Windows (cmd)
npm install
npm run dev
```

## Notes

* Commit forcé demandé par l'utilisateur.
