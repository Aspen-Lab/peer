import { beforeEach } from "vitest";

function removeAmbientProviderKeys() {
  delete process.env.GOOGLE_API_KEY;
  delete process.env.TAVILY_API_KEY;
}

removeAmbientProviderKeys();
beforeEach(removeAmbientProviderKeys);
