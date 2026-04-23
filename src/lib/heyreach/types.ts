export type HeyReachCampaignStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "PAUSED"
  | "FINISHED"
  | "CANCELED"
  | "FAILED"
  | "STARTING"
  | "SCHEDULED";

export type HeyReachListType = "USER_LIST" | "COMPANY_LIST";

export type HeyReachTagColor =
  | "Blue"
  | "Green"
  | "Purple"
  | "Pink"
  | "Red"
  | "Cyan"
  | "Yellow"
  | "Orange";

export type HeyReachWebhookEvent =
  | "CONNECTION_REQUEST_SENT"
  | "CONNECTION_REQUEST_ACCEPTED"
  | "MESSAGE_SENT"
  | "MESSAGE_REPLY_RECEIVED"
  | "INMAIL_SENT"
  | "INMAIL_REPLY_RECEIVED"
  | "FOLLOW_SENT"
  | "LIKED_POST"
  | "VIEWED_PROFILE"
  | "CAMPAIGN_COMPLETED"
  | "LEAD_TAG_UPDATED"
  | "EVERY_MESSAGE_REPLY_RECEIVED";

export type HeyReachTimeFilter =
  | "CreationTime"
  | "Everywhere"
  | "LastActionTakenTime"
  | "FailedTime"
  | "LastActionTakenOrFailedTime";

export interface HeyReachPaginatedResponse<T> {
  totalCount: number;
  items: T[];
}

export interface HeyReachCampaignProgressStats {
  totalUsers: number;
  totalUsersInProgress: number;
  totalUsersPending: number;
  totalUsersFinished: number;
  totalUsersFailed: number;
  totalUsersManuallyStopped?: number;
  totalUsersExcluded?: number;
}

export interface HeyReachCampaign {
  id: number;
  name: string;
  creationTime: string;
  linkedInUserListName?: string | null;
  linkedInUserListId?: number | null;
  campaignAccountIds: number[];
  status: HeyReachCampaignStatus | null;
  progressStats: HeyReachCampaignProgressStats;
  excludeInOtherCampaigns?: boolean;
  excludeHasOtherAccConversations?: boolean;
  excludeContactedFromSenderInOtherCampaign?: boolean;
  excludeAlreadyMessagedGlobal?: boolean;
  excludeAlreadyMessagedCampaignAccounts?: boolean;
  excludeFirstConnectionCampaignAccounts?: boolean;
  excludeFirstConnectionGlobal?: boolean;
  excludeNoProfilePicture?: boolean;
  excludeListId?: number | null;
  organizationUnitId?: number;
}

export interface HeyReachGetAllCampaignsParams {
  offset?: number;
  limit?: number;
  keyword?: string;
  statuses?: HeyReachCampaignStatus[];
  accountIds?: number[];
}

export interface HeyReachCustomUserField {
  name: string;
  value: string;
}

export interface HeyReachLeadInput {
  firstName?: string;
  lastName?: string;
  location?: string;
  summary?: string;
  companyName?: string;
  position?: string;
  about?: string;
  emailAddress?: string;
  profileUrl: string;
  customUserFields?: HeyReachCustomUserField[];
}

export interface HeyReachLead {
  profileUrl: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  imageUrl?: string;
  location?: string;
  companyName?: string;
  companyUrl?: string;
  position?: string;
  about?: string;
  connections?: number;
  followers?: number;
  tags?: string[];
  emailAddress?: string;
  customFields?: HeyReachCustomUserField[];
}

export interface HeyReachAccountLeadPair {
  linkedInAccountId: number;
  lead: HeyReachLeadInput;
}

export interface HeyReachAddLeadsToCampaignParams {
  campaignId: number;
  accountLeadPairs: HeyReachAccountLeadPair[];
  resumeFinishedCampaign?: boolean;
  resumePausedCampaign?: boolean;
}

export interface HeyReachAddLeadsResult {
  addedLeadsCount: number;
  updatedLeadsCount: number;
  failedLeadsCount: number;
}

export interface HeyReachStopLeadInCampaignParams {
  campaignId: number;
  leadMemberId?: string;
  leadUrl?: string;
}

export interface HeyReachGetLeadsFromCampaignParams {
  campaignId: number;
  offset?: number;
  limit?: number;
  timeFrom?: string;
  timeTo?: string;
  timeFilter?: HeyReachTimeFilter;
}

export interface HeyReachGetCampaignsForLeadParams {
  email?: string;
  linkedinId?: string;
  profileUrl?: string;
  offset?: number;
  limit?: number;
}

export interface HeyReachLinkedInAccount {
  id: number;
  emailAddress?: string;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
  activeCampaigns?: number;
  authIsValid?: boolean;
  isValidNavigator?: boolean;
  isValidRecruiter?: boolean;
  profileUrl?: string;
}

export interface HeyReachGetAllLinkedInAccountsParams {
  offset?: number;
  limit?: number;
  keyword?: string;
}

export interface HeyReachList {
  id: number;
  name: string;
  totalItemsCount?: number;
  count?: number;
  listType: HeyReachListType | null;
  creationTime: string;
  campaignIds?: number[];
  campaigns?: unknown[] | null;
  isDeleted?: boolean;
  status?: string;
}

export interface HeyReachGetAllListsParams {
  offset?: number;
  limit?: number;
  keyword?: string;
  listType?: HeyReachListType;
  campaignIds?: number[];
}

export interface HeyReachGetLeadsFromListParams {
  listId: number;
  offset?: number;
  limit?: number;
  keyword?: string;
  leadProfileUrl?: string;
  leadLinkedInId?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface HeyReachCompany {
  name: string;
  description?: string;
  industry?: string;
  imageUrl?: string;
  companySize?: string;
  employeesOnLinkedIn?: number;
  location?: string;
  specialities?: string;
  website?: string;
}

export interface HeyReachGetCompaniesFromListParams {
  listId: number;
  offset?: number;
  limit?: number;
  keyword?: string;
}

export interface HeyReachAddLeadsToListParams {
  listId: number;
  leads: HeyReachLeadInput[];
}

export interface HeyReachDeleteLeadsFromListParams {
  listId: number;
  leadMemberIds: string[];
}

export interface HeyReachDeleteLeadsFromListByProfileUrlParams {
  listId: number;
  profileUrls: string[];
}

export interface HeyReachGetListsForLeadParams {
  email?: string;
  linkedinId?: string;
  profileUrl?: string;
  offset?: number;
  limit?: number;
}

export interface HeyReachCreateEmptyListParams {
  name: string;
  type: HeyReachListType;
}

export interface HeyReachInboxFilters {
  linkedInAccountIds?: number[];
  campaignIds?: number[];
  searchString?: string;
  leadLinkedInId?: string;
  leadProfileUrl?: string;
  tags?: string[];
  seen?: boolean | null;
}

export interface HeyReachGetConversationsParams {
  filters?: HeyReachInboxFilters;
  offset?: number;
  limit?: number;
}

export interface HeyReachChatMessage {
  createdAt: string;
  body?: string;
  subject?: string;
  postLink?: string;
  isInMail?: boolean;
  sender?: unknown;
}

export interface HeyReachChatroom {
  id: string;
  read: boolean;
  groupChat: boolean;
  blockedByMe?: boolean;
  blockedByParticipant?: boolean;
  lastMessageAt?: string;
  lastMessageText?: string;
  lastMessageSender?: unknown;
  totalMessages?: number;
  linkedInAccountId: number;
  correspondentProfile?: HeyReachLead;
  linkedInAccount?: HeyReachLinkedInAccount;
  messages?: HeyReachChatMessage[];
}

export interface HeyReachSendMessageParams {
  message: string;
  conversationId: string;
  linkedInAccountId: number;
  subject?: string;
}

export interface HeyReachSetSeenStatusParams {
  conversationId: string;
  linkedInAccountId: number;
  seen: boolean;
}

export interface HeyReachGetOverallStatsParams {
  accountIds?: number[];
  campaignIds?: number[];
  startDate: string;
  endDate: string;
}

export interface HeyReachDayStats {
  profileViews: number;
  postLikes: number;
  follows: number;
  messagesSent: number;
  totalMessageStarted: number;
  totalMessageReplies: number;
  inmailMessagesSent: number;
  totalInmailStarted: number;
  totalInmailReplies: number;
  connectionsSent: number;
  connectionsAccepted: number;
  messageReplyRate: number;
  inMailReplyRate: number;
  connectionAcceptanceRate: number;
}

export interface HeyReachOverallStatsResponse {
  byDayStats: Record<string, HeyReachDayStats>;
  [key: string]: unknown;
}

export interface HeyReachTagInput {
  displayName: string;
  color: HeyReachTagColor;
}

export interface HeyReachTag {
  displayName: string;
  color: HeyReachTagColor;
}

export interface HeyReachLeadTagsParams {
  leadProfileUrl?: string;
  leadLinkedInId?: string;
  tags: string[];
  createTagIfNotExisting?: boolean;
}

export interface HeyReachWebhook {
  id: number;
  webhookName: string;
  webhookUrl: string;
  eventType: HeyReachWebhookEvent;
  campaignIds?: number[];
  isActive?: boolean;
  createdAt?: string;
}

export interface HeyReachCreateWebhookParams {
  webhookName: string;
  webhookUrl: string;
  eventType: HeyReachWebhookEvent;
  campaignIds?: number[];
}

export interface HeyReachUpdateWebhookParams {
  webhookName?: string | null;
  webhookUrl?: string | null;
  eventType?: HeyReachWebhookEvent | null;
  campaignIds?: number[] | null;
  isActive?: boolean | null;
}

export interface HeyReachMyNetworkParams {
  senderId: number;
  pageNumber?: number;
  pageSize?: number;
}

export interface HeyReachIsConnectionParams {
  senderAccountId: number;
  leadProfileUrl?: string;
  leadLinkedInId?: string;
}
