function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get JWT_SECRET() {
    return required("JWT_SECRET");
  },
  get PORT() {
    return Number(process.env.PORT ?? "3000");
  },
};
