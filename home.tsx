"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Menu, Plus, Heart, MessageSquare, User, Send, Mic, Camera, MoreHorizontal } from "lucide-react"

const travelSuggestions = [
  { title: "Weekend getaway to Mumbai", gradient: "from-orange-600 to-red-600" },
  { title: "Affordable flights to Delhi", gradient: "from-gray-600 to-blue-600" },
  { title: "Luxury stay in Goa", gradient: "from-red-600 to-orange-500" },
  { title: "Business trip to Bengaluru", gradient: "from-purple-600 to-pink-600" },
]

const previousTrips = [
  { name: "Delhi to Bangalore Adventure", liked: true },
  { name: "Untitled trip", liked: false },
  { name: "LAX to LAS Trip", liked: false },
]

export function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [message, setMessage] = useState("")

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Sidebar */}
      <div
        className={`${sidebarOpen ? "w-80" : "w-0"} transition-all duration-300 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden`}
      >
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-white hover:bg-gray-700"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-lg">KAYAK·ai</span>
              <Badge variant="outline" className="text-white border-gray-600 bg-transparent text-xs">
                Beta
              </Badge>
            </div>
          </div>

          <Button className="w-full bg-gray-700 hover:bg-gray-600 text-white border-gray-600" variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            Start a new plan
          </Button>
        </div>

        <div className="flex-1 p-4">
          <div className="mb-4">
            <h3 className="text-gray-400 text-sm font-medium mb-3">Previous 7 days</h3>
            <div className="space-y-2">
              {previousTrips.map((trip, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 rounded hover:bg-gray-700 cursor-pointer group"
                >
                  <span className="text-white text-sm">{trip.name}</span>
                  {trip.liked && <Heart className="w-4 h-4 text-red-500 fill-current" />}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-700">
          <Button variant="ghost" className="w-full justify-start text-gray-400 hover:text-white hover:bg-gray-700">
            <MessageSquare className="w-4 h-4 mr-2" />
            Send feedback
          </Button>

          <div className="mt-4 text-xs text-gray-500 space-y-1">
            <p>©2025 KAYAK.ai</p>
            <div className="flex gap-2">
              <a href="#" className="hover:text-gray-400">
                Privacy
              </a>
              <a href="#" className="hover:text-gray-400">
                Terms & Conditions
              </a>
            </div>
            <div className="flex gap-2">
              <a href="#" className="hover:text-gray-400">
                Ad Choices
              </a>
              <a href="#" className="hover:text-gray-400">
                How KAYAK.ai works
              </a>
            </div>
            <a href="#" className="hover:text-gray-400">
              Product Updates & New Features
            </a>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="text-white hover:bg-gray-700"
            >
              <Menu className="w-5 h-5" />
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="text-white hover:bg-gray-700">
            <User className="w-5 h-5" />
          </Button>
        </div>

        {/* Main Dashboard */}
        <div className="flex-1 relative overflow-hidden">
          {/* Background Gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-orange-900/20 to-red-900/30" />

          <div className="relative z-10 flex flex-col items-center justify-center h-full p-8">
            <h1 className="text-4xl font-bold text-white mb-12">Welcome back, harshit</h1>

            {/* Travel Suggestions Grid */}
            <div className="grid grid-cols-2 gap-6 mb-16 w-full max-w-4xl">
              {travelSuggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className={`relative h-48 rounded-2xl bg-gradient-to-br ${suggestion.gradient} p-6 cursor-pointer hover:scale-105 transition-transform duration-200 group`}
                >
                  <h3 className="text-white text-xl font-semibold">{suggestion.title}</h3>
                  <div className="absolute bottom-4 right-4">
                    <div className="w-8 h-8 bg-black/20 rounded-full flex items-center justify-center">
                      <MoreHorizontal className="w-4 h-4 text-white" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chat Input */}
        <div className="p-6">
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <div className="flex items-center bg-gray-800 rounded-full border border-gray-600 p-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask away."
                  className="flex-1 bg-transparent border-none text-white placeholder-gray-400 focus:ring-0 focus:outline-none px-4"
                />
                <div className="flex items-center gap-2 pr-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-400 hover:text-white hover:bg-gray-700 rounded-full w-8 h-8 p-0"
                  >
                    <Camera className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-400 hover:text-white hover:bg-gray-700 rounded-full w-8 h-8 p-0"
                  >
                    <Mic className="w-4 h-4" />
                  </Button>
                  <Button size="sm" className="bg-white text-black hover:bg-gray-200 rounded-full w-8 h-8 p-0">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
