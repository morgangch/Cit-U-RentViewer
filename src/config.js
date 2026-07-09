/**
 * Configuration centrale de CiteU Rent Viewer.
 *
 * Tout ce qui est spécifique au site du CROUS (sélecteurs, libellés du PDF)
 * est regroupé ici : si un CROUS (MTP, LIL, ...) a un HTML ou un avis
 * d'échéance légèrement différent, c'est le seul fichier à ajuster.
 *
 * Chargé à la fois dans le content script et dans le background
 * (d'où globalThis : pas de window dans un service worker).
 */
globalThis.CiteURV = globalThis.CiteURV || {};

globalThis.CiteURV.config = {
  // La page "Mon logement actuel" elle-même (là où on injecte le résumé).
  // Le préfixe /citeU-XXX est variable selon le CROUS.
  logementPagePattern: /^\/citeU-[^/]+\/mon-logement-actuel\/?$/,

  // Lien "Accéder à l'ensemble de mes documents" (un par logement / bloc-cite).
  documentsLinkSelector: 'a[href*="/mon-logement-actuel/mes-documents/pj/"]',

  // Blocs logement sur la page (un onglet par résidence).
  blocCiteSelector: '.bloc-cite',

  // Dans le HTML brut de la page "Mes documents" : premier lien vers un avis
  // d'échéance (le site les trie du plus récent au plus ancien).
  // Capture 1 = href, capture 2 = libellé du lien.
  // (regex plutôt que DOMParser : moins d'API DOM = moins de surface pour
  // les erreurs Xray du sandbox des content scripts Firefox)
  avisLinkPattern: /href="([^"]*\/avis_echeance\/[^"]+)"[^>]*>\s*([^<]*)/,

  // Extraction des montants dans le texte du PDF.
  // Chaque entrée : liste de regex essayées dans l'ordre ; la 1re qui matche
  // gagne. Le montant est cherché juste après le libellé (voir avis-parser).
  pdfLabels: {
    // "Montant ALS attendu" (ou APL selon la CAF / le CROUS).
    // Repli : certains CROUS (ex. Montpellier) n'ont pas cette ligne et
    // l'aide n'apparaît que comme encaissement "CAF REGIE (E) APL0924/ ...".
    aide: [
      /Montant\s+(?:ALS|APL|AL)\s+attendue?/i,
      /(?:ALS|APL)\s+attendue?/i,
      /CAF\s+REGIE[^]{0,20}?(?:APL|ALS)\d*\/?/i
    ],
    // Repli si la section "DROITS CONSTATES" (voir droitsConstatesSection)
    // est introuvable : chercher directement un total explicite.
    loyer: [
      /Total\s+(?:à|a)\s+payer/i,
      /\bTotal\b/i
    ]
  },

  // Section listant les charges du mois (loyer, charges, compl. mobilier,
  // ...) : "DROITS CONSTATES ... SITUATION DE VOTRE COMPTE". Le montant du
  // loyer du mois est la somme de tous les montants de cette section — plus
  // robuste qu'un libellé "Total", qui n'apparaît pas quand il n'y a qu'une
  // seule ligne de charge (le CROUS omet alors le mot "Total").
  droitsConstatesSection: {
    start: /DROITS\s+CONSTATES/i,
    end: /SITUATION\s+DE\s+VOTRE\s+COMPTE/i
  },

  // Solde du compte locataire à la date de l'avis : "Solde débiteur au
  // 10/06/2026" (négatif, tu dois de l'argent) ou "Solde créditeur au ..."
  // (positif, tu as un crédit). Capture 1 = débiteur|créditeur.
  soldePattern: /Solde\s+(débiteur|créditeur)\s+au\s+\d{2}\/\d{2}\/\d{4}/i,

  // Repli : "Solde au 01/07/2026 0,00" — le CROUS omet le qualificatif
  // débiteur/créditeur quand le compte est à l'équilibre.
  soldeNeutralPattern: /Solde\s+au\s+\d{2}\/\d{2}\/\d{4}/i,

  // Fenêtre (en caractères) après le libellé dans laquelle on cherche le montant.
  amountSearchWindow: 120
};
