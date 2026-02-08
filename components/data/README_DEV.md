# components/data — Guide dev (IA-friendly)

Ce dossier contient la **logique de données** (state + persistance + calculs) de l'app.
Objectif : que les pages UI restent "bêtes" et que toute la logique soit ici.

---

## Cartographie rapide (qui fait quoi)

- **storageKeys.ts**
  - Source de vérité de **toutes les clés localStorage**.
  - ⚠️ Invariant : ne jamais hardcoder une clé ailleurs.

- **storage.ts**
  - Helpers génériques : `readJSON`, `writeJSON`, `uid`, `sumAmounts`, normalisation `{variables, fixes}`.
  - ⚠️ Invariant : toute lecture/écriture passe par ces helpers (évite les divergences).

- **owners.ts**
  - Helper unique pour itérer le périmètre "foyer + personnes" : `listOwners(ctx, opts)`.
  - ✅ C'est la source de vérité du **périmètre** (Global vs Person).
  - ⚠️ DANGER : changer ici impacte *tous* les totaux et la persistance.

- **moneyLinesEngine.ts**
  - Moteur générique `useMoneyLines()` pour gérer des listes de lignes (add/edit/remove, Global/Person, etc.).
  - Le store spécifique (flows/...) ne fait plus que :
    - adapter le format storage <-> `MoneyLine`
    - choisir le périmètre owners

- **flowsStore.tsx**
  - Adaptateur storage pour revenus/dépenses.
  - Utilise `useMoneyLines()` + `listOwners()`.
  - ⚠️ Invariant : la persistance doit itérer **exactement** sur les owners affichés.

- **estateDefaults.ts**
  - Déclare les lignes "lockées" / defaults (labels, ids, ordre).
  - ⚠️ Invariant : les defaults doivent rester stables (id/label) sinon migration implicite.

- **estateMath.ts**
  - Calculs partagés de patrimoine/locations (net, totaux) utilisés par store + menu.

- **estateStore.tsx**
  - Adaptateur storage pour patrimoine + locations.
  - Applique les defaults lockés et utilise `estateMath`.

- **useMenuTotals.tsx**
  - Calcule les totaux affichés dans le menu.
  - ⚠️ Invariant : doit matcher les mêmes périmètres owners que les pages concernées.

---

## Lexique (termes utilisés dans le code)

- **Foyer** : données communes (communes).
- **Person** : données par personne (p/[personId]).
- **Global mode** : l'écran agrège/affiche foyer + toutes les personnes.
- **Person mode** : l'écran affiche le foyer + une personne (ou seulement la personne, selon écran).

---

## Invariants critiques (à ne pas casser)

### 1) Périmètre Global vs Person
- Tout ce qui somme / affiche / persiste doit utiliser **`listOwners()`**.
- **WHY** : sans ça, on risque d'écraser des données d'autres personnes (non affichées).

### 2) Totaux = périmètre identique à la page
- `useMenuTotals` doit suivre les mêmes règles de périmètre que les pages `depenses`, `revenus`, `patrimoine`, `locations`.
- **DANGER** : sinon l'utilisateur voit un total incohérent vs le détail.

### 3) Defaults lockés
- Les lignes "standards" sont injectées si absentes et restent `locked`.
- **WHY** : conserver l'UI stable (ordre/labels) + éviter des états impossibles.

### 4) Storage = une seule source de vérité
- Les clés sont dans `storageKeys.ts`.
- JSON read/write via `storage.ts`.
- **DANGER** : des écritures ad-hoc créent des formats différents et cassent les migrations.

---

## Recettes rapides

### Ajouter une nouvelle catégorie de lignes (ex: nouvelle section de dépenses)
1. Définir une clé dans `storageKeys.ts`.
2. Définir le format storage minimal (id, label, amount, locked...).
3. Adapter dans le store concerné :
   - `loadXxx()` : storage -> `MoneyLine[]`
   - `persistXxx()` : `MoneyLine[]` -> storage
4. Si c'est un écran de liste : réutiliser `useMoneyLines()`.
5. Si ça impacte les totaux menu : ajouter la somme correspondante dans `useMenuTotals.tsx`.

### Modifier la règle "quand on agrège"
- Toujours commencer par `owners.ts`.
- Puis vérifier : `flowsStore.tsx`, `estateStore.tsx`, `useMenuTotals.tsx`.

---

## Tests manuels minimaux (checklist)

- Global : les totaux menu == somme foyer + toutes les personnes.
- Person : les totaux menu == foyer + personne sélectionnée (ou règle écran).
- Ajouter/supprimer une ligne : persiste après refresh.
- Les lignes lockées :
  - toujours présentes
  - non supprimables
  - ordre stable
