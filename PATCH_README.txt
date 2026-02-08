Patch: Fix build - ChevronSpacer undefined (Patrimoine > Bien)

Erreur:
  app/(app)/patrimoine/[id]/page.tsx: Cannot find name 'ChevronSpacer'

Fix:
- Remplace <ChevronSpacer /> par un <span> invisible inline (même taille/alignement).
- Supprime la fonction ChevronSpacer du fichier.

✅ Après application, vérifie:
  Select-String -Path "app\(app)\patrimoine\[id]\page.tsx" -Pattern "ChevronSpacer"
→ aucun résultat.

Puis:
  npm run build
