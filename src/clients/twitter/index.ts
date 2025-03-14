import { TwitterClientInterface } from "./client";
import { TwitterAutoCopyClient } from "./auto-copy-client";
import { TwitterFollowerClient } from "./follower-client";

const twitterPlugin = {
  name: "twitter",
  description: "Twitter client",
  clients: [TwitterClientInterface],
};
export default twitterPlugin;
export { TwitterAutoCopyClient, TwitterFollowerClient };
