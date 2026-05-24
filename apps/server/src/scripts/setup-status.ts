import { userCount } from "@/modules/auth/auth-service";

const count = userCount();
console.log(JSON.stringify({ needsSetup: count === 0, userCount: count }, null, 2));
