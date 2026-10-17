/** Pending capability; no pixels or success can be returned by this interface. */
export type PdfRenderingCapability = {
  available: false;
  reason: "PDF_RENDERING_PENDING";
};
export const pdfRendering: PdfRenderingCapability = {
  available: false,
  reason: "PDF_RENDERING_PENDING",
};
