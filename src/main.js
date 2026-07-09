/**
 * Orchestrateur (content script) : sur la page "Mon logement actuel", pour
 * chaque logement, suit le lien "Accéder à l'ensemble de mes documents",
 * repère le dernier avis d'échéance (PDF), le télécharge (session
 * same-origin), en extrait les montants et les affiche.
 *
 * Tout tourne dans le content script, sans background ni messaging : les
 * allers-retours sendMessage déclenchaient des erreurs Xray sous Firefox
 * (« Permission denied to access property "constructor" »).
 */
(() => {
  const { config, api, avisParser, ui } = globalThis.CiteURV;

  async function processBloc(blocElement) {
    const documentsUrl = api.findDocumentsUrl(blocElement);
    if (!documentsUrl) return; // pas de lien documents dans ce bloc

    let step = 'initialisation';
    try {
      step = 'chargement de la page « Mes documents »';
      const documentsHtml = await api.fetchHtml(documentsUrl);

      step = 'recherche de l’avis d’échéance';
      const avis = api.findLatestAvis(documentsHtml);
      if (!avis) {
        ui.renderError(blocElement, 'aucun avis d’échéance trouvé dans « Mes documents ».');
        return;
      }

      step = 'téléchargement du PDF';
      const pdfBuffer = await api.fetchPdf(avis.url);

      step = 'extraction des montants du PDF';
      const pdfBytes = new Uint8Array(pdfBuffer);
      const amounts = avisParser.parse(pdfBytes);

      // amounts.aide/loyer peuvent être null légitimement (rien à facturer,
      // pas d'aide ce mois-ci, ou libellé non reconnu) : on affiche le
      // panneau avec ce qu'on a plutôt que de bloquer sur un champ manquant.
      if (amounts.loyer === null) {
        // Diagnostic : affiche le texte brut extrait du PDF dans la console
        // pour pouvoir ajuster les regex de config.js sans avoir besoin du
        // PDF original (qui contient des données personnelles).
        const text = globalThis.CiteURV.pdfText.extractText(pdfBytes);
        console.warn('[CiteURentViewer] loyer introuvable, texte extrait du PDF :', text);
      }

      step = 'affichage du panneau';
      ui.renderPanel(blocElement, { ...amounts, avisUrl: avis.url, avisLabel: avis.label });
    } catch (error) {
      console.error(`[CiteURentViewer] échec à l’étape « ${step} »`, error);
      ui.renderError(blocElement, `échec à l’étape « ${step} » (${error.message}).`);
    }
  }

  function run() {
    // Le match du manifest couvre aussi les sous-pages (/mes-documents/...) :
    // on ne s'exécute que sur la page "Mon logement actuel" elle-même.
    if (!config.logementPagePattern.test(location.pathname)) return;

    document.querySelectorAll(config.blocCiteSelector).forEach(processBloc);
  }

  run();
})();
