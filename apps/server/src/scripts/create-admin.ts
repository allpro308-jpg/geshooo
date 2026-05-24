import { createAdminUser } from "@/modules/auth/auth-service";
import { generatePassword } from "@/shared/crypto/passwords";

type Args = {
  email?: string;
  username?: string;
  password?: string;
  displayName?: string;
};

const args = parseArgs(process.argv.slice(2));

if (!args.email || !args.username) {
  console.error("Usage: npm run admin:create -- --email admin@example.com --username admin [--password value]");
  process.exit(1);
}

const password = args.password ?? generatePassword();

try {
  const user = await createAdminUser({
    email: args.email,
    username: args.username,
    password,
    displayName: args.displayName
  });

  console.log("Admin user created");
  console.log(`Email: ${user.email}`);
  console.log(`Username: ${user.username}`);
  if (!args.password) {
    console.log(`Password: ${password}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Failed to create admin user: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || !value) {
      continue;
    }

    index += 1;
    if (key === "--email") parsed.email = value;
    if (key === "--username") parsed.username = value;
    if (key === "--password") parsed.password = value;
    if (key === "--display-name") parsed.displayName = value;
  }
  return parsed;
}
