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

Le fichier `lib/prisma.ts` essaye maintenant de faire un **auto-heal en dev** :
si le client Prisma n'existe pas encore, il tente de lancer `npx prisma generate` une fois.
