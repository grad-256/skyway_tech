export async function fetchSkyWayToken(): Promise<string> {
  try {
    const response = await fetch("http://localhost:3001/generate-token", {
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    })

    if (!response.ok) {
      throw new Error("Failed to fetch SkyWay token")
    }

    const data = await response.json()
    return data.token
  } catch (error) {
    console.error("Error fetching SkyWay token:", error)
    throw error
  }
}
