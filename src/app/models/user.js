import mongoose from 'mongoose';
const Schema = mongoose.Schema;

module.exports = mongoose.model('User', new Schema({
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
    gcm_key: {
        type: String,
        required: true
    },
    email_id: {
        type: String,
        required: true
    },
    access_token: {
        type: String,
        required: false
    },
}));