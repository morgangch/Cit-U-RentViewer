/**
 * Accès aux pages / fichiers de l'extranet Cité U.
 * Tous les fetch sont same-origin : la session de l'utilisateur est réutilisée.
 */
globalThis.CiteURV = globalThis.CiteURV || {};

globalThis.CiteURV.api = (() => {
  const config = globalThis.CiteURV.config;

  async function fetchOk(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} sur ${url}`);
    }
    return response;
  }

  /** Récupère le HTML brut d'une page du site. */
  async function fetchHtml(url) {
    return (await fetchOk(url)).text();
  }

  /**
   * Trouve, dans un bloc logement de la page courante, le lien
   * "Accéder à l'ensemble de mes documents" (/mes-documents/pj/<code>).
   */
  function findDocumentsUrl(blocElement) {
    const link = blocElement.querySelector(config.documentsLinkSelector);
    return link ? link.getAttribute('href') : null;
  }

  /**
   * Dans le HTML de la page "Mes documents", trouve le premier avis
   * d'échéance (le plus récent). Retourne { url, label } ou null.
   */
  function findLatestAvis(documentsHtml) {
    const match = documentsHtml.match(config.avisLinkPattern);
    if (!match) return null;
    return {
      url: match[1],
      label: match[2].trim().replace(/\s+/g, ' ')
    };
  }

  /** Télécharge le PDF (servi en application/octet-stream) en ArrayBuffer. */
  async function fetchPdf(url) {
    return (await fetchOk(url)).arrayBuffer();
  }

  return { fetchHtml, findDocumentsUrl, findLatestAvis, fetchPdf };
})();
