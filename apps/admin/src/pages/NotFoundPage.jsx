import { Link } from 'react-router-dom';
import { Home, AlertCircle } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-muted p-6">
            <AlertCircle className="h-16 w-16 text-muted-foreground" />
          </div>
        </div>
        <h1 className="mb-2 text-4xl font-bold text-foreground">404</h1>
        <p className="mb-6 text-lg text-muted-foreground">
          Page not found
        </p>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Home className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}