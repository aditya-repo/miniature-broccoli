import dns from "node:dns";

// Avoid `querySrv ECONNREFUSED` for `mongodb+srv` when the default Node resolver (e.g. 127.0.0.53) fails.
dns.setServers(["1.1.1.1"]);
