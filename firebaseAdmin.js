
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const serviceAccount = require("./web-blogs-app-firebase-adminsdk-fbsvc-36cc320e1b.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export default admin;
