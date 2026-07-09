# CiteU Rent Viewer

Extension navigateur (Manifest V3) pour l'extranet locataire Cité U des CROUS
(`messervices.etudiant.gouv.fr/citeU-*`).

## Pourquoi

L'extranet Cité U affiche le loyer et l'aide au logement dans des PDF séparés
(un « avis d'échéance » par mois, à ouvrir un par un), sans jamais montrer le
reste à charge réel. Cette extension récupère le dernier avis automatiquement
et affiche directement sur la page « Mon logement actuel » ce qu'on veut
savoir en un coup d'œil : combien reste à payer ce mois-ci.

Sur la page **« Mon logement actuel »**, elle affiche automatiquement, pour
chaque logement :

- **Montant loyer** — somme des lignes « DROITS CONSTATES » (loyer, charges,
  compl. mobilier, ...) du dernier avis d'échéance ;
- **Montant APL/ALS attendu** — la ligne « Montant ALS attendu » (ou APL),
  ou « — » si l'avis n'en mentionne aucune (traité comme 0€ dans le calcul) ;
- **Différence (reste à charge)** — loyer − aide ;
- **Solde débiteur/créditeur** — le solde du compte locataire à la date de
  l'avis (négatif = tu dois de l'argent au CROUS, positif = tu as un crédit).

## Comment ça marche

1. Sur `/citeU-<CROUS>/mon-logement-actuel`, le content script repère dans
   chaque bloc logement le lien « Accéder à l'ensemble de mes documents »
   (`/mon-logement-actuel/mes-documents/pj/<code>`).
2. Il fetch cette page (session existante, cookies same-origin) et y trouve le
   premier lien `avis_echeance` de l'onglet « Derniers avis d'échéance »
   (le plus récent, le site les trie du plus récent au plus ancien).
3. Il télécharge le PDF (servi en `application/octet-stream`), en extrait le
   texte avec un extracteur maison ([src/pdf-text.js](src/pdf-text.js) :
   flux FlateDecode décompressés via pako, opérateurs texte Tj/TJ, polices
   CID traduites via leur table /ToUnicode) et parse les montants par regex.
   Le loyer est cherché dans la section « DROITS CONSTATES ... SITUATION DE
   VOTRE COMPTE » : s'il y a un « Total » explicite dedans on lui fait
   confiance, sinon (une seule ligne de charge, cas où le CROUS n'affiche
   même pas le mot « Total ») on additionne les montants de la section.
   Si l'avis n'a pas de ligne « Montant ALS attendu » (cas de certains
   CROUS, ex. Montpellier), l'aide est lue depuis l'encaissement
   « CAF REGIE ... APL/ALS » ; si l'avis ne mentionne aucune aide du tout,
   elle est traitée comme 0€.
4. Il injecte un panneau récapitulatif dans le bloc logement, avec un lien
   vers le PDF.

Aucun serveur tiers : tout reste entre le navigateur et le site du CROUS.
Tout s'exécute en content script ; il n'y a ni background ni messaging (voir
« Notes techniques » plus bas pour pourquoi).

## Installation (Chrome / Edge / Brave)

1. `chrome://extensions` → activer le **Mode développeur**.
2. **Charger l'extension non empaquetée** → choisir ce dossier.
3. Recharger la page « Mon logement actuel ».

Firefox desktop : `about:debugging#/runtime/this-firefox` → « Charger un
module complémentaire temporaire » → sélectionner `manifest.json`.

## Tester sur mobile (Firefox Android)

Firefox pour Android accepte les extensions installées manuellement. Deux
options :

- **Local, temporaire** : connecter le téléphone en USB, activer le débogage
  distant, et charger l'extension via `about:debugging` sur desktop connecté
  au téléphone.
- **Lien direct, durable** : publier sur
  [addons.mozilla.org](https://addons.mozilla.org) en mode **non répertorié**
  (« unlisted ») — review automatique rapide, pas de visibilité publique,
  donne un lien d'installation `.xpi` utilisable sur Firefox Android comme
  sur desktop. C'est la voie recommandée pour toi et ton amie.

## Publier publiquement

Possible et raisonnable : l'extension ne fait que lire tes propres documents
via ta session existante, sans backend tiers. Pour publier en « listed »
(visible dans les recherches AMO) :

- Créer un compte développeur sur addons.mozilla.org (gratuit).
- Le code minifié tiers (`vendor/pako_inflate.min.js`) doit être accompagné
  de son source non minifié en upload séparé lors de la review — c'est une
  formalité, pas un blocage.
- Bien vérifier qu'aucune donnée personnelle (PDF, capture, numéro
  allocataire) n'est jamais commitée dans le dépôt avant de le rendre public
  (voir `.gitignore`).

Chrome Web Store est une option distincte (compte développeur payant
one-shot, review différente) si tu veux aussi couvrir Chrome/Edge mobile —
non nécessaire pour Firefox Android.

## Adapter à un autre CROUS / format d'avis

Le code est indépendant du CROUS : le préfixe `citeU-LIL` / `citeU-MTP` / etc.
vient du match pattern du manifest et n'est jamais codé en dur. Testé avec
succès sur de vrais avis LIL et MTP (formats de solde, de ligne d'aide et de
nombre de lignes de charges différents). Si un avis d'échéance utilise
d'autres libellés, tout se règle dans [src/config.js](src/config.js) :

- `pdfLabels.aide` / `pdfLabels.loyer` : regex des libellés cherchés dans le
  PDF (la première qui matche gagne) ;
- `droitsConstatesSection` : bornes de la section des charges du mois ;
- `soldePattern` : regex du solde débiteur/créditeur ;
- `documentsLinkSelector` / `avisLinkPattern` : sélecteur et regex des liens ;
- `amountSearchWindow` : distance max (caractères) entre le libellé et son
  montant.

## Notes techniques

Trois approches ont été essayées avant la version actuelle et ont toutes
échoué avec des erreurs Xray Firefox (« Permission denied to access property
... ») propres au sandbox des content scripts WebExtension : **pdf.js**
directement, un **script d'arrière-plan** utilisant `DecompressionStream`,
puis le **messaging `sendMessage`** lui-même. La version actuelle est
volontairement 100 % content script, en JS pur, sans API DOM/streams/
messaging exotique — seuls `fetch`, des regex et `Uint8Array` sont utilisés.

Attention si tu modifies `pdf-text.js` : ne jamais utiliser
`TextDecoder('latin1')` sur les octets du PDF — c'est en réalité du
windows-1252, qui remappe les octets 0x80-0x9F et corrompt les codes de
glyphes des polices CID utilisées par les avis CROUS.

Attention si tu modifies la regex de montant (`AMOUNT_SOURCE` dans
`avis-parser.js`) : le séparateur de milliers ne doit accepter que des
espaces insécables (` `/` `), jamais une espace normale (`\s`).
Une espace normale sépare aussi des tokens PDF distincts (ex. une quantité
« 1 » collée au montant suivant), ce qui fusionnait par le passé deux
nombres voisins en un seul montant erroné lors d'un balayage de section
large (`sumAmounts`).

## Structure

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Déclaration MV3, match sur `citeU-*/mon-logement-actuel*` |
| `src/config.js` | Sélecteurs et libellés (seul fichier à adapter) |
| `src/citeu-api.js` | Fetch des pages/PDF de l'extranet |
| `src/pdf-text.js` | Extraction du texte du PDF (pako pour FlateDecode) |
| `src/avis-parser.js` | Parsing des montants dans le texte |
| `src/ui.js` | Injection du panneau dans la page |
| `src/main.js` | Orchestration |
| `vendor/pako_inflate.min.js` | pako 2.1.0 (inflate zlib pur JS) |
