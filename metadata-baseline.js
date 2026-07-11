// Baseline of common Salesforce standard objects and universal standard fields.
// Standard metadata is not present in local SFDX source, so this list lets the
// metadata rules avoid flagging standard names as "unknown". It does not need to
// be exhaustive — the metadata/unknown-object rule only flags custom (__c) names
// it cannot find, and metadata/unknown-field only flags custom fields.

const STANDARD_OBJECTS = [
    'Account', 'Contact', 'Lead', 'Opportunity', 'OpportunityLineItem', 'Case',
    'CaseComment', 'Campaign', 'CampaignMember', 'User', 'UserRole', 'Group',
    'Profile', 'PermissionSet', 'Task', 'Event', 'Product2', 'Pricebook2',
    'PricebookEntry', 'Order', 'OrderItem', 'Contract', 'Quote', 'QuoteLineItem',
    'Asset', 'Solution', 'Idea', 'ContentDocument', 'ContentVersion',
    'ContentDocumentLink', 'Attachment', 'Note', 'EmailMessage', 'FeedItem',
    'FeedComment', 'RecordType', 'Report', 'Dashboard', 'Document', 'Folder',
    'BusinessHours', 'Holiday', 'Period', 'Organization', 'ApexClass', 'ApexTrigger',
    'ApexPage', 'StaticResource', 'EntityDefinition', 'FieldDefinition',
    'AggregateResult', 'Name', 'QueueSobject', 'ProcessInstance', 'ProcessInstanceStep',
    'AccountContactRelation', 'Territory', 'Individual', 'Location'
];

const COMMON_STANDARD_FIELDS = [
    'Id', 'Name', 'CreatedById', 'CreatedDate', 'LastModifiedById', 'LastModifiedDate',
    'OwnerId', 'IsDeleted', 'SystemModstamp', 'RecordTypeId', 'CurrencyIsoCode',
    'LastActivityDate', 'LastViewedDate', 'LastReferencedDate'
];

module.exports = { STANDARD_OBJECTS, COMMON_STANDARD_FIELDS };
