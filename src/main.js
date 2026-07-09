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
      const amounts = avisParser.parse(new Uint8Array(pdfBuffer));

      if (amounts.loyer === null && amounts.aide === null) {
        ui.renderError(blocElement, 'montants introuvables dans le PDF (libellés inattendus ?).');
        return;
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
