import mongoose from 'mongoose';
const Schema = mongoose.Schema;

module.exports = mongoose.model('User', new Schema({
    name: String,
    pic_url: String,
    google_id: String,
    gcm_key: String,
    email_id: String,
    access_token: String
}));