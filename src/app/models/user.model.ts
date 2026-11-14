export interface User {
  id: number;
  name: string;
  email: string;
  password: string; // plaintext only for this demo — hash on the backend in real apps
}

export interface LoggedInUser {
  userID: number;
  fullName: string;
  username: string;
  role: string;
}