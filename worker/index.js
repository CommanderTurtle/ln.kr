import { handleResolverRequest } from "./proxy.js";

export default {
  fetch (request) {
    return handleResolverRequest(request);
  }
};

