import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Mail, Info } from "lucide-react"

export function AuthPage() {
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center px-4 relative">
      {/* US Flag in top right */}
      <div className="absolute top-4 right-4">
        <div className="w-6 h-4 bg-red-500 rounded-sm flex items-center justify-center">
          <span className="text-white text-xs">🇺🇸</span>
        </div>
      </div>

      <div className="w-full max-w-md space-y-8">
        {/* Logo and Title */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-3xl font-bold text-white">KAYAK·ai</h1>
            <Badge variant="outline" className="text-white border-gray-600 bg-transparent">
              Beta
            </Badge>
          </div>

          <div className="space-y-2">
            <p className="text-gray-400 text-sm">Brought to you by</p>
            <div className="inline-flex items-center bg-orange-500 px-3 py-1 rounded">
              <span className="text-white font-bold text-lg tracking-wider">KAYAK</span>
            </div>
          </div>
        </div>

        {/* Authentication Options */}
        <div className="space-y-4">
          <Button className="w-full bg-white text-black hover:bg-gray-100 h-12 text-base font-medium" size="lg">
            <Mail className="w-5 h-5 mr-2 text-orange-500" />
            Continue with email
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-600" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-gray-900 px-2 text-gray-400">or</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-12 bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google
            </Button>

            <Button variant="outline" className="h-12 bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              Apple
            </Button>
          </div>
        </div>

        {/* Terms and Privacy */}
        <div className="text-center text-xs text-gray-400">
          By signing up, you accept our{" "}
          <a href="#" className="text-blue-400 hover:underline">
            terms of use
          </a>{" "}
          and{" "}
          <a href="#" className="text-blue-400 hover:underline">
            privacy policy
          </a>
          .
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Info className="w-4 h-4" />
          <span>KAYAK.ai uses OpenAI's artificial intelligence model, ChatGPT.</span>
          <a href="#" className="text-blue-400 hover:underline ml-1">
            Learn more
          </a>
        </div>
      </div>
    </div>
  )
}
