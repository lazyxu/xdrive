import Foundation

@main struct NativePasswordProfilesChecks {
    static func main() throws {
        typealias Profiles = XDriveIOSNativePasswordProfiles
        let one = Profiles.profile(server: "https://drive.example.com",
                                   lanIP: "192.168.1.30", username: "alice")
        let otherServer = Profiles.profile(server: "https://backup.example.com",
                                           lanIP: "192.168.1.30", username: "alice")
        let otherRoute = Profiles.profile(server: "https://drive.example.com",
                                          lanIP: "192.168.1.31", username: "alice")
        let otherUser = Profiles.profile(server: "https://drive.example.com",
                                         lanIP: "192.168.1.30", username: "bob")
        precondition(one != nil && otherServer != nil && otherRoute != nil && otherUser != nil)
        precondition(Set([one!.id, otherServer!.id, otherRoute!.id, otherUser!.id]).count == 4)
        precondition(Profiles.profile(server: "http://drive.example.com",
                                      lanIP: "", username: "alice") == nil)
        precondition(Profiles.profile(server: "https://alice:secret@drive.example.com",
                                      lanIP: "", username: "alice") == nil)
        precondition(Profiles.profile(server: "https://drive.example.com/api",
                                      lanIP: "", username: "alice") == nil)
        precondition(Profiles.profile(server: "https://drive.example.com",
                                      lanIP: "8.8.8.8", username: "alice") == nil)
        precondition(Profiles.profile(server: "https://drive.example.com",
                                      lanIP: "", username: "alice\nadmin") == nil)
        print("iOS native saved-password profile identity and strict HTTPS checks passed")
    }
}
