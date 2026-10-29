/**
 * HubSpot webhook event types.
 */
export enum HubspotEventType {
  DealCreated = 'deal.creation',
  DealUpdated = 'deal.propertyChange',
  DealDeleted = 'deal.deletion',
  ContactCreated = 'contact.creation',
  ContactUpdated = 'contact.propertyChange',
  ContactDeleted = 'contact.deletion',
}
