export const AUCTION_BID_STEP = 100;

// Round after adding the increment so older, non-rounded bids still rise by at least 100k.
export const minimumAuctionBid = (price: number, currentBid: number) =>
  Math.ceil(Math.max(price, currentBid + AUCTION_BID_STEP) / AUCTION_BID_STEP) * AUCTION_BID_STEP;

export const maximumAuctionBid = (balance: number) =>
  Math.max(0, Math.floor(balance / AUCTION_BID_STEP) * AUCTION_BID_STEP);
