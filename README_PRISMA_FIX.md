# Prisma: erreur "Cannot find module '.prisma/client/default'"

Si tu vois :

```
Error: Cannot find module '.prisma/client/default'
```

ça veut dire que **Prisma Client n'a pas été généré** (ou a été supprimé) dans `node_modules/.prisma/client`.

## Fix rapide

1) Vérifie que tu as bien ces dépendances :

- `@prisma/client`
- `prisma`

2) Puis génère le client :

```bash
npx prisma generate
```

3) (Optionnel mais recommandé) mets ça dans `package.json` pour que ce soit automatique :

```json
{
  "scripts": {
    "postinstall": "prisma generate"
  }
}
```

## Note

Le projet evite ce probleme via les scripts:

- `postinstall`: lance `prisma generate`
- `build`: relance `prisma generate` avant `next build`
