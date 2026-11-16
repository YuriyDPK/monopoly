export const AUCTION_BID_STEP = 100;

// Round after adding the increment so older, non-rounded bids still rise by at least 100k.
export const minimumAuctionBid = (price: number, currentBid: number, step = AUCTION_BID_STEP) =>
  Math.ceil(Math.max(price, currentBid + step) / step) * step;

export const maximumAuctionBid = (balance: number, step = AUCTION_BID_STEP) =>
  Math.max(0, Math.floor(balance / step) * step);
