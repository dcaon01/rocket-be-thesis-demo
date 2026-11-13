/**
 * Enum for S3 entity types.
 * Used to determine the S3 key structure and entity update logic.
 */
export enum S3EntityType {
  /** Product logo image */
  ProductLogo = 'PRODUCT_LOGO',
  /** File of a sales material offered to the resale network (catalogue, price list, presentation). */
  MaterialFile = 'MATERIAL_FILE',
  /** DOCX source of a document template (the indirect-channel offer). */
  TemplateSource = 'TEMPLATE_SOURCE',
  /** Reseller logo image, rendered on the indirect-channel offers. */
  ResellerLogo = 'RESELLER_LOGO',
  /** Offer signed by the customer, uploaded on acceptance (PDF). */
  OrderSignedOffer = 'ORDER_SIGNED_OFFER',
  /** Contract signed with the finance company of a financed order (PDF). */
  OrderFinancingContract = 'ORDER_FINANCING_CONTRACT',
  /** PDF describing the customization requested on an order. */
  OrderCustomizationAttachment = 'ORDER_CUSTOMIZATION_ATTACHMENT',
  /** Voice note describing the customization requested on an order. */
  OrderCustomizationVoiceNote = 'ORDER_CUSTOMIZATION_VOICE_NOTE',
  /** Framework agreement signed by a reseller, attached to its contract with Keus (PDF). */
  ResellerContractSigned = 'RESELLER_CONTRACT_SIGNED',
}
