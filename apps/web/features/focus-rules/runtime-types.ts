export type ApiMailAddressLike = { address: string };

export type ApiMailMessageLike = {
  to: ApiMailAddressLike[];
  body?: string;
  snippet: string;
};

export type ApiMailThreadLike = {
  subject: string;
  preview: string;
  participants: ApiMailAddressLike[];
  messages: ApiMailMessageLike[];
};
