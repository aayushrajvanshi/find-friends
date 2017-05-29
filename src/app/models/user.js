import mongoose from 'mongoose';
const Schema = mongoose.Schema;

module.exports = mongoose.model('User', new Schema({
    email_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    pic_url: {
        type: String,
        required: false
    },
    google_id: {
        type: String,
        required: true
    },
    fcm_key: {
        type: String,
        required: true
    },
    location: {
        latitude: {
            type: String,
            required: false,
            default: ''
        },
        longitude: {
            type: String,
            required: false,
            default: ''
        }
    },
    access_token: {
        type: String,
        required: false,
        unique: true,
        index: true
    },
}));